import { realpath } from 'node:fs/promises';
import { formatDimensionNote, resizeImage } from '@earendil-works/pi-coding-agent';
import { errorMessage, type FileRef, type TaskRun } from '@atd/agent-contracts';
import { loadPathCached } from './file-loader/load-cache.js';
import type { FileHint, FileLoader, LoadedFile } from './file-loader/loader.js';
import {
  materialText,
  measureText,
  measureUtf8,
  shareBudget,
  type MaterialSource,
} from './file-loader/material.js';
import type { Logger } from './logging.js';
import type { ResourceStore } from './resources.js';
import type { RunAttachment } from './run-material.js';
import { materialBudget, type MaterialBudget } from './tasks/run-budget.js';

type LoadedImage = Extract<LoadedFile, { kind: 'image' }>;

/** What a run reads its files through: each resource's file and the name and type it was stored with. */
export type AttachmentResources = Pick<ResourceStore, 'pathOf' | 'forTask'>;

/** A file whose text waits for its share of the budget, which depends on every file's size. */
interface Measured {
  name: string;
  path: string;
  source: MaterialSource;
}

/**
 * Reads a run's files as its material through the file loader (file-loader/loader.ts), which
 * decides by content, the stored name and media type only hinting: an image becomes image input
 * for the model, any other file its loaded text (decoded text, a document's extracted text or a
 * description), cut to its share of the material budget (file-loader/material.ts). Each names its
 * resource's file, which the task's read tool opens without asking and reads as the same text,
 * through the same conversion cache (file-loader/load-cache.ts). A file that cannot be read stays
 * in the material as a note saying why, so the run still starts and the model knows it is
 * missing; once `signal` aborts, loading stops and rejects with its reason.
 */
export async function loadRunAttachments(
  resources: AttachmentResources,
  files: readonly FileRef[],
  budget: MaterialBudget,
  log: Logger,
  taskId: string,
  signal?: AbortSignal,
  loader?: FileLoader,
): Promise<RunAttachment[]> {
  const task = resources.forTask(taskId);
  /** The file's content, or why it could not be read. */
  const contentOf = async (
    path: string,
    hint: FileHint,
  ): Promise<LoadedFile | { reason: string }> => {
    try {
      const options = { hint, ...(signal ? { signal } : {}) };
      return await loadPathCached(await realpath(path), options, loader);
    } catch (error) {
      if (signal?.aborted) throw error;
      log.warn('Attachment unreadable; continuing without it.', {
        taskId,
        error: errorMessage(error),
      });
      return { reason: unreadable(error) };
    }
  };
  const loaded: Array<RunAttachment | Measured> = [];
  // One file at a time: an image is scaled whole, and a long text is kept only as far as a share
  // can use it before the next file loads.
  for (const file of files) {
    signal?.throwIfAborted();
    const entry = { name: file.name, path: resources.pathOf(file.id) };
    // The stored name and type, as `read` hints the resource (file-loader/read-tool.ts
    // `resourceHints`), so the first read of a cut file reuses the conversion made here.
    const hint = task.hint(file.id);
    const content = hint
      ? await contentOf(entry.path, hint)
      : { reason: "it is no longer in the app's storage" };
    if ('reason' in content) loaded.push(unavailable(entry, content.reason));
    else if (content.kind === 'image') loaded.push(await imageAttachment(entry, content));
    else
      loaded.push({
        ...entry,
        source:
          content.kind === 'utf8'
            ? measureUtf8(content.bytes, budget.perFile)
            : measureText(content.text, budget.perFile),
      });
  }
  // Images and unread files take no share.
  const shares = shareBudget(
    loaded.map((item) => ('source' in item ? item.source.tokens : 0)),
    budget,
  );
  return loaded.map((item, index) =>
    'source' in item
      ? {
          kind: 'text',
          name: item.name,
          path: item.path,
          text: materialText(item.source, shares[index] ?? 0, budget.read),
        }
      : item,
  );
}

/**
 * The attachments of runs being prepared, loaded so that Stop and shutdown end the loading: a run
 * stays `queued` until its runner starts it, so nothing else would stop it (runner-manager.ts).
 */
export class AttachmentLoads {
  private readonly loading = new Map<string, AbortController>();

  constructor(
    private readonly resources: AttachmentResources,
    private readonly log: Logger,
  ) {}

  /**
   * A run's attachments within its material budget (tasks/run-budget.ts), or null when `stop` or
   * `stopAll` ended the loading.
   */
  async load(run: TaskRun, taskId: string): Promise<RunAttachment[] | null> {
    const controller = new AbortController();
    this.loading.set(run.id, controller);
    try {
      const attachments = await loadRunAttachments(
        this.resources,
        run.snapshot.input.files,
        materialBudget(run.snapshot),
        this.log,
        taskId,
        controller.signal,
      );
      return controller.signal.aborted ? null : attachments;
    } catch (error) {
      if (controller.signal.aborted) return null;
      throw error;
    } finally {
      this.loading.delete(run.id);
    }
  }

  stop(runId: string): void {
    this.loading.get(runId)?.abort();
  }

  stopAll(): void {
    for (const controller of this.loading.values()) controller.abort();
  }
}

/**
 * A file the run could not load, listed in the material in its place with why, as unavailable
 * references are (references/material.ts).
 */
function unavailable(entry: { name: string }, reason: string): RunAttachment {
  return { kind: 'unavailable', name: entry.name, reason };
}

/** Why the copy of an attached file could not be read, in words for the model. */
function unreadable(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT') return "its copy is missing from the app's storage";
  if (code === 'EACCES' || code === 'EPERM') return 'the app is not allowed to open its copy';
  return 'its copy could not be read';
}

/**
 * The size an attached image enters the session at. Pi re-sends every history image on every
 * request, so each one is kept near the models' native resolution: 1568px is what the standard
 * vision tier sees anyway, and staying under 2000px keeps Anthropic's stricter many-image rule
 * from applying. The byte cap counts base64 and leaves JPEG at a quality where screenshot text
 * stays legible; an image already inside both limits passes untouched.
 */
const INGEST_IMAGE = { maxWidth: 1568, maxHeight: 1568, maxBytes: 1024 * 1024, jpegQuality: 85 };

/**
 * Fits the image to the ingest size here, so the coordinate note for a scaled image goes into
 * the hidden run material instead of Pi appending it to the visible message. Pi still applies the
 * model's own limits to the prompt's images, and converts a BMP the scaling passed untouched. An
 * image that cannot be decoded or scaled is not sent at all: Pi would drop it from the message
 * and leave the material's image numbers pointing at the wrong pictures, so the material says
 * instead that it was not sent.
 */
async function imageAttachment(
  entry: { name: string; path: string },
  loaded: LoadedImage,
): Promise<RunAttachment> {
  const resized = await resizeImage(loaded.bytes, loaded.mime, INGEST_IMAGE);
  if (!resized) {
    const text =
      '[Unavailable as image input: the image could not be decoded or scaled to a size models take, so it was not sent. Tell the user when this matters for the answer.]';
    return { kind: 'text', ...entry, text };
  }
  const notes = [
    loaded.convertedFrom ? `[Image converted from ${loaded.convertedFrom} to JPEG.]` : '',
    formatDimensionNote(resized) ?? '',
  ].filter(Boolean);
  return {
    kind: 'image',
    ...entry,
    image: { type: 'image', data: resized.data, mimeType: resized.mimeType },
    ...(notes.length ? { note: notes.join('\n') } : {}),
  };
}
