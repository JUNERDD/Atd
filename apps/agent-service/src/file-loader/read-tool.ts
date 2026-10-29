import { AsyncLocalStorage } from 'node:async_hooks';
import { stat } from 'node:fs/promises';
import {
  createReadToolDefinition,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ReadOperations,
} from '@earendil-works/pi-coding-agent';
import type { TaskResources } from '../resources.js';
import { resourceIdAt } from '../service-fs.js';
import type { ResolvePath } from '../tool-proxies.js';
import { formatHint, formatOf } from './formats.js';
import { IMAGE_HEADER_BYTES, oversizeNote } from './image-size.js';
import { fileLoader, readStart, type FileHint, type FileLoader } from './loader.js';
import { detect } from './sniff.js';

/** Converted files `read` keeps, by count and by total size. */
const CACHE_ENTRIES = 32;
const CACHE_BYTES = 128 * 1024 * 1024;

/** What `read` hands Pi for a file: its bytes, and their media type when they are an image. */
interface ReadResult {
  bytes: Buffer;
  mime: string | null;
}

/** The abort signal of the `read` call an operation runs in; Pi passes its operations none. */
const calls = new AsyncLocalStorage<AbortSignal | undefined>();

const DESCRIPTION = [
  'Read a file of any format.',
  'Text comes back as its text, decoded from whatever encoding the file uses.',
  'Documents (PDF, Word, Excel, PowerPoint, OpenDocument, RTF, EPUB, Pages, Keynote, Numbers and similar) come back as their extracted text: a bracketed first line says what was extracted and what was left out, and `--- Page N ---`, `## Sheet: <name>` or `## Slide N` lines mark the parts.',
  'Images come back as image input; HEIC, TIFF and AVIF are converted first.',
  'Any other file comes back as a short description: its type, size and, for an archive, its first entries.',
  `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first); use offset/limit to page through it, and continue with offset until complete.`,
  'Converted text is read-only: edit works only on UTF-8 text files.',
].join(' ');

/**
 * The name and media type the file at a real path is known by, when its path does not say: a task
 * resource's file is named by its id alone.
 */
export type HintResolver = (real: string) => Promise<FileHint | undefined>;

const noHints: HintResolver = () => Promise.resolve(undefined);

/**
 * The stored name and media type of the resource a read opens (resources.ts), so `read` sees a
 * resource as the run's attachment material saw it.
 */
export function resourceHints(
  resources: Pick<TaskResources, 'dir' | 'hint'>,
  cwd: string,
): HintResolver {
  return async (real) => {
    const id = await resourceIdAt(resources.dir, cwd, real);
    return id === null ? undefined : resources.hint(id);
  };
}

/**
 * Pi's read tool over the file loader (loader.ts), for the parent and every subagent child: the
 * same text and line numbers as a run's attachment material, images as image input. `readable`
 * confines each path, as the caller decides; `hintOf` names a file its path does not; the call's
 * abort signal reaches the loader.
 */
export function loaderReadTool(
  cwd: string,
  readable: ResolvePath,
  hintOf: HintResolver = noHints,
  loader: FileLoader = fileLoader,
): ReturnType<typeof createReadToolDefinition> {
  const operations = readOperations(readable, hintOf, loader);
  const tool = createReadToolDefinition(cwd, { operations });
  return {
    ...tool,
    description: DESCRIPTION,
    execute(toolCallId, params, signal, onUpdate, ctx) {
      return calls.run(signal, () => tool.execute(toolCallId, params, signal, onUpdate, ctx));
    },
  };
}

/**
 * Pi's read operations. An image (by its signature) is image input, after a conversion for the
 * formats models do not take; any other file is the loader's text as UTF-8, which Pi pages by
 * lines. Pi asks for an image's media type before reading it, so that answer applies the loader's
 * own gate. Conversions are cached by real path, size, modification time and hint; UTF-8 text
 * passes through uncached. One cache serves every task's tools: an entry is the file's own
 * content, reached only after `readable` allowed the path.
 */
function readOperations(
  readable: ResolvePath,
  hintOf: HintResolver,
  loader: FileLoader,
): ReadOperations {
  const result = async (real: string): Promise<ReadResult> => {
    const info = await stat(real);
    const hint = await hintOf(real);
    const key = [real, info.size, info.mtimeMs, hint?.name, hint?.mime].join('\0');
    const cached = cache.get(key);
    if (cached) return cached;
    const signal = calls.getStore();
    const loaded = await loader.loadPath(real, {
      ...(hint ? { hint } : {}),
      ...(signal ? { signal } : {}),
    });
    switch (loaded.kind) {
      case 'utf8':
        return { bytes: asBuffer(loaded.bytes), mime: null };
      case 'text':
        return cache.put(key, { bytes: Buffer.from(loaded.text, 'utf8'), mime: null });
      case 'image': {
        const image = { bytes: asBuffer(loaded.bytes), mime: loaded.mime };
        return loaded.convertedFrom ? cache.put(key, image) : image;
      }
    }
  };
  return {
    readFile: async (target) => (await result(await readable(target))).bytes,
    access: async (target) => {
      await stat(await readable(target));
    },
    detectImageMimeType: async (target) => {
      const real = await readable(target);
      const head = await readStart(real, IMAGE_HEADER_BYTES);
      const hint = await hintOf(real);
      const found = detect(head, formatHint(hint?.name ?? real, hint?.mime));
      if (found.route === 'image')
        return oversizeNote(found.id, head) ? null : formatOf(found.id).mime;
      return found.route === 'convert' ? (await result(real)).mime : null;
    },
  };
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The most recently used conversions, bounded by `CACHE_ENTRIES` and `CACHE_BYTES`. */
class ConversionCache {
  private readonly entries = new Map<string, ReadResult>();
  private bytes = 0;

  get(key: string): ReadResult | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  put(key: string, entry: ReadResult): ReadResult {
    if (entry.bytes.byteLength > CACHE_BYTES) return entry;
    this.drop(key);
    this.entries.set(key, entry);
    this.bytes += entry.bytes.byteLength;
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= CACHE_ENTRIES && this.bytes <= CACHE_BYTES) break;
      this.drop(oldest);
    }
    return entry;
  }

  private drop(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes.byteLength;
  }
}

const cache = new ConversionCache();
