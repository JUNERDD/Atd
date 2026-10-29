import { formatDimensionNote, resizeImage } from '@earendil-works/pi-coding-agent';
import { errorMessage, type FileRef } from '@atd/agent-contracts';
import { fileLoader, type FileLoader, type LoadedFile } from './file-loader/loader.js';
import { materialText, shareBudget } from './file-loader/material.js';
import type { Logger } from './logging.js';
import type { RunAttachment } from './pi-session.js';
import type { ResourceStore } from './resources.js';

type LoadedImage = Extract<LoadedFile, { kind: 'image' }>;

/**
 * Reads a run's files as its material through the file loader (file-loader/loader.ts), which
 * decides by content, the stored name and media type only hinting: an image becomes image input
 * for the model, any other file its loaded text (decoded text, a document's extracted text or a
 * description), cut to its share of the material budget (file-loader/material.ts). Each names its
 * resource's file, which the task's read tool opens without asking and reads as the same text. A
 * file that cannot be read is skipped so the run still starts without it; once `signal` aborts,
 * loading stops and rejects with its reason.
 */
export async function loadRunAttachments(
  resources: Pick<ResourceStore, 'readBytes' | 'pathOf'>,
  files: readonly FileRef[],
  log: Logger,
  taskId: string,
  signal?: AbortSignal,
  loader: FileLoader = fileLoader,
): Promise<RunAttachment[]> {
  const loaded: { name: string; path: string; file: LoadedFile }[] = [];
  for (const file of files) {
    signal?.throwIfAborted();
    try {
      const { resource, bytes } = await resources.readBytes(file.id);
      const input = { bytes, name: file.name, mime: resource.mime };
      loaded.push({
        name: file.name,
        path: resources.pathOf(file.id),
        file: await loader.load(input, signal),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      log.warn('Attachment unreadable; continuing without it.', {
        taskId,
        error: errorMessage(error),
      });
    }
  }
  const texts = loaded.map(({ file }) => textOf(file));
  const shares = shareBudget(texts.map((text) => text.length));
  const attachments: RunAttachment[] = [];
  // One image at a time: scaling decodes each whole.
  for (const [index, { name, path, file }] of loaded.entries()) {
    signal?.throwIfAborted();
    attachments.push(
      file.kind === 'image'
        ? await imageAttachment(name, path, file)
        : { kind: 'text', name, path, text: materialText(texts[index] ?? '', shares[index] ?? 0) },
    );
  }
  return attachments;
}

/**
 * The attachments of runs being prepared, loaded so that Stop and shutdown end the loading: a run
 * stays `queued` until its runner starts it, so nothing else would stop it (runner-manager.ts).
 */
export class AttachmentLoads {
  private readonly loading = new Map<string, AbortController>();

  constructor(
    private readonly resources: Pick<ResourceStore, 'readBytes' | 'pathOf'>,
    private readonly log: Logger,
  ) {}

  /** Run `runId`'s attachments, or null when `stop` or `stopAll` ended the loading. */
  async load(
    runId: string,
    files: readonly FileRef[],
    taskId: string,
  ): Promise<RunAttachment[] | null> {
    const controller = new AbortController();
    this.loading.set(runId, controller);
    try {
      const attachments = await loadRunAttachments(
        this.resources,
        files,
        this.log,
        taskId,
        controller.signal,
      );
      return controller.signal.aborted ? null : attachments;
    } catch (error) {
      if (controller.signal.aborted) return null;
      throw error;
    } finally {
      this.loading.delete(runId);
    }
  }

  stop(runId: string): void {
    this.loading.get(runId)?.abort();
  }

  stopAll(): void {
    for (const controller of this.loading.values()) controller.abort();
  }
}

/** A loaded file's text; an image has none, so it takes no share of the material budget. */
function textOf(file: LoadedFile): string {
  if (file.kind === 'utf8')
    return Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength).toString(
      'utf8',
    );
  return file.kind === 'text' ? file.text : '';
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
 * model's own limits to the prompt's images, and converts a BMP the scaling passed untouched.
 * When the image cannot be scaled it is passed as it is, and Pi reports what it cannot send.
 */
async function imageAttachment(
  name: string,
  path: string,
  loaded: LoadedImage,
): Promise<RunAttachment> {
  const resized = await resizeImage(loaded.bytes, loaded.mime, INGEST_IMAGE);
  const notes = [
    loaded.convertedFrom ? `[Image converted from ${loaded.convertedFrom} to JPEG.]` : '',
    resized ? (formatDimensionNote(resized) ?? '') : '',
  ].filter(Boolean);
  return {
    kind: 'image',
    name,
    path,
    image: resized
      ? { type: 'image', data: resized.data, mimeType: resized.mimeType }
      : {
          type: 'image',
          data: Buffer.from(loaded.bytes).toString('base64'),
          mimeType: loaded.mime,
        },
    ...(notes.length ? { note: notes.join('\n') } : {}),
  };
}
