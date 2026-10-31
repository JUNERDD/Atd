import { AsyncLocalStorage } from 'node:async_hooks';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import {
  createReadToolDefinition,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type AgentToolResult,
  type ReadOperations,
  type ReadToolDetails,
  type ReadToolInput,
} from '@earendil-works/pi-coding-agent';
import type { TaskResources } from '../resources.js';
import { resolveToolPath, resourceIdAt } from '../service-fs.js';
import type { ResolvePath } from '../tool-proxies.js';
import type { ExtractionLayout } from './extraction-paths.js';
import { entryOf, extractionNote, type ExtractionEntry } from './extraction-store.js';
import { formatHint, formatOf } from './formats.js';
import { IMAGE_HEADER_BYTES, oversizeNote } from './image-size.js';
import { loadPathCached } from './load-cache.js';
import { readStart } from './load-path.js';
import { fileLoader, type FileHint, type FileLoader } from './loader.js';
import { readTarget } from './read-target.js';
import { detect } from './sniff.js';
import { largeTextPage, longLineText, PAGED_TEXT_BYTES, type TextPage } from './text-pages.js';

/**
 * What `read` hands Pi for a file: its bytes, their media type when they are an image, and the
 * extraction entry that keeps a converted file's content (extraction-store.ts).
 */
interface ReadResult {
  bytes: Buffer;
  mime: string | null;
  entry?: ExtractionEntry;
}

/**
 * One `read` call: its abort signal, which Pi passes its operations none of; the line it starts
 * at; the file as loaded for it; whether the file is a text file (sniff.ts route `text`), whose
 * text grep can search, unlike a document's; and the text Pi pages.
 */
interface ReadCall {
  signal: AbortSignal | undefined;
  offset: number | undefined;
  loaded?: { real: string; result: Promise<ReadResult> };
  plainText?: boolean;
  paged?: Buffer;
}

type ReadToolResult = AgentToolResult<ReadToolDetails | undefined>;

const calls = new AsyncLocalStorage<ReadCall>();

/** What `read` returns for an empty file; codemode scripts get its text, which is empty. */
const EMPTY_FILE = '(empty file)';

const DESCRIPTION = [
  'Read a file of any format.',
  'Text comes back as its text, decoded from whatever encoding the file uses.',
  'Documents (PDF, Word, Excel, PowerPoint, OpenDocument, RTF, EPUB, Pages, Keynote, Numbers and similar) come back as their extracted text: a bracketed first line says what was extracted and what was left out, and `--- Page N ---`, `## Sheet: <name>` or `## Slide N` lines mark the parts.',
  'Images come back as image input; HEIC, TIFF and AVIF are converted first.',
  'Any other file comes back as a short description: its type, size and, for an archive, its first entries.',
  `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first); use offset/limit to page through it, and continue with offset until complete.`,
  'Converted text is read-only: edit works only on UTF-8 text files.',
  "A converted file's result ends with an [Extracted files: …] note naming a folder that holds its text as text.txt, for grep, beside any pictures and whole sheets the text names.",
].join(' ');

/**
 * The name and media type the file at a real path is known by, when its path does not say: a task
 * resource's file is named by its id alone.
 */
export type HintResolver = (real: string) => Promise<FileHint | undefined>;

const noHints: HintResolver = () => Promise.resolve(undefined);

/**
 * What a read tool loads files through besides its confinement: the names files are known by, the
 * loader, and the store that keeps what conversions extract (extraction-paths.ts).
 */
export interface ReadToolOptions {
  hintOf?: HintResolver;
  loader?: FileLoader;
  extractions?: ExtractionLayout;
}

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
 * abort signal reaches the loader. An empty file and a page of a large UTF-8 text file are
 * answered here (`readDirect`); Pi reads everything else, and a line too long for its page gets
 * its first part instead of Pi's bash command (`withLongLine`).
 */
export function loaderReadTool(
  cwd: string,
  readable: ResolvePath,
  { hintOf = noHints, loader = fileLoader, extractions }: ReadToolOptions = {},
): ReturnType<typeof createReadToolDefinition> {
  const operations = readOperations(readable, hintOf, loader, extractions);
  const tool = createReadToolDefinition(cwd, { operations });
  return {
    ...tool,
    description: DESCRIPTION,
    execute(toolCallId, params, signal, onUpdate, ctx) {
      const call: ReadCall = { signal, offset: params.offset };
      return calls.run(call, async () => {
        // The path as Pi resolves it before falling back to a macOS spelling of a missing name.
        const target = resolveToolPath(ctx?.cwd || cwd, params.path);
        const direct = await abortable(signal, () =>
          readDirect(target, params, readable, hintOf, signal),
        );
        if (direct) return direct;
        const result = await tool.execute(toolCallId, params, signal, onUpdate, ctx);
        const entry = (await call.loaded?.result.catch(() => undefined))?.entry;
        return withEntry(withLongLine(result, params, call, entry !== undefined), entry);
      });
    },
  };
}

/**
 * The answer for a file that exists at `target` and needs none of Pi's reading: `(empty file)`,
 * or a page of a UTF-8 text file over `PAGED_TEXT_BYTES`, read from byte ranges (text-pages.ts)
 * instead of whole. Null for any other file, and for a missing one, whose macOS spellings Pi
 * tries. `readable` refuses a path here just as Pi's operations would.
 */
async function readDirect(
  target: string,
  request: Pick<ReadToolInput, 'offset' | 'limit'>,
  readable: ResolvePath,
  hintOf: HintResolver,
  signal: AbortSignal | undefined,
): Promise<ReadToolResult | null> {
  if (!(await exists(target))) return null;
  const { real, info } = await readTarget(readable, target);
  if (info.size === 0)
    return {
      content: [{ type: 'text', text: EMPTY_FILE }],
      details: undefined,
      structuredContent: '',
    };
  if (info.size <= PAGED_TEXT_BYTES) return null;
  const page = await largeTextPage(real, await hintOf(real), request, signal);
  return page && textResult(page);
}

/** Whether a path exists, as Pi checks before it tries other spellings. */
async function exists(target: string): Promise<boolean> {
  return access(target, constants.F_OK).then(
    () => true,
    () => false,
  );
}

function textResult({ text, details }: TextPage): ReadToolResult {
  return { content: [{ type: 'text', text }], details, structuredContent: text };
}

/**
 * Pi shows nothing of a first line over its byte limit and points at bash; this shows the
 * line's first part with a note (text-pages.ts `longLineText`), from the text Pi paged. The note
 * says grep finds the rest of the line when the file is a text file or its text has an entry.
 */
function withLongLine(
  result: ReadToolResult,
  { offset }: Pick<ReadToolInput, 'offset'>,
  call: ReadCall,
  extracted: boolean,
): ReadToolResult {
  const { paged } = call;
  if (!paged || !result.details?.truncation?.firstLineExceedsLimit) return result;
  const startLine = offset ? Math.max(0, offset - 1) : 0;
  let start = 0;
  for (let skip = Math.trunc(startLine); skip > 0; skip -= 1)
    start = paged.indexOf(0x0a, start) + 1;
  const end = paged.indexOf(0x0a, start);
  const line = {
    display: startLine + 1,
    size: (end === -1 ? paged.length : end) - start,
    more: end !== -1,
    searchable: call.plainText === true || extracted,
  };
  const text = longLineText(paged.subarray(start, start + DEFAULT_MAX_BYTES + 1), line);
  return { ...result, content: [{ type: 'text', text }], structuredContent: text };
}

/**
 * The result with the entry that keeps the converted file's content named in a text block of its
 * own after the file's text and Pi's notes (extraction-store.ts `extractionNote`): Pi built
 * `structuredContent`, which codemode scripts page through, from the first block alone, so the
 * file's text and its line numbers stay `read`'s. The line break before it parts it from the text
 * where the blocks are joined.
 */
function withEntry(result: ReadToolResult, entry: ExtractionEntry | undefined): ReadToolResult {
  if (!entry) return result;
  const note = { type: 'text' as const, text: `\n${extractionNote(entry)}` };
  return { ...result, content: [...result.content, note] };
}

/** `work`, settled at once with Pi's own error when `signal` aborts, as Pi's read settles. */
function abortable<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  if (signal?.aborted) return Promise.reject(new Error('Operation aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('Operation aborted'));
    signal?.addEventListener('abort', onAbort, { once: true });
    void work()
      .then(resolve, reject)
      .finally(() => signal?.removeEventListener('abort', onAbort));
  });
}

/**
 * Pi's read operations. An image (by its signature) is image input, after a conversion for the
 * formats models do not take; any other file is the loader's text as UTF-8, which Pi pages by
 * lines, without a final line break: that break ends the last line, so a file of N lines that
 * each end in one counts N, as a paged file does. A call for line N+1 gets the text with a final
 * break, which Pi pages as one empty line: an empty page, as a paged file gives there too
 * (text-pages.ts), so a script that steps `offset` until a page comes back empty stops cleanly;
 * any offset further on is Pi's error. Pi asks for an image's media type before reading it, so
 * that answer applies the loader's own gate; the call loads the file once for both, so a
 * conversion that failed, which the cache does not keep, is not tried twice. Conversions go
 * through the cache attachment material shares (load-cache.ts), reached only after `readable`
 * allowed the path.
 */
function readOperations(
  readable: ResolvePath,
  hintOf: HintResolver,
  loader: FileLoader,
  extractions: ExtractionLayout | undefined,
): ReadOperations {
  const load = async (real: string, signal: AbortSignal | undefined): Promise<ReadResult> => {
    const hint = await hintOf(real);
    const options = {
      ...(hint ? { hint } : {}),
      ...(signal ? { signal } : {}),
      ...(extractions ? { extractions } : {}),
    };
    const loaded = await loadPathCached(real, options, loader);
    switch (loaded.kind) {
      case 'utf8':
        return { bytes: asBuffer(loaded.bytes), mime: null };
      case 'text': {
        const entry = entryOf(loaded);
        return { bytes: Buffer.from(loaded.text, 'utf8'), mime: null, ...(entry ? { entry } : {}) };
      }
      case 'image':
        return { bytes: asBuffer(loaded.bytes), mime: loaded.mime };
    }
  };
  const result = (real: string): Promise<ReadResult> => {
    const call = calls.getStore();
    if (call?.loaded?.real === real) return call.loaded.result;
    const loading = load(real, call?.signal);
    if (call) call.loaded = { real, result: loading };
    return loading;
  };
  return {
    readFile: async (target) => {
      const { bytes, mime } = await result(await readable(target));
      if (mime !== null) return bytes;
      const text = bytes.at(-1) === NEWLINE ? bytes.subarray(0, -1) : bytes;
      const call = calls.getStore();
      if (call) call.paged = text;
      return isLineAfterLast(text, call?.offset) ? Buffer.concat([text, LINE_BREAK]) : text;
    },
    access: async (target) => {
      await readTarget(readable, target);
    },
    detectImageMimeType: async (target) => {
      const real = await readable(target);
      const head = await readStart(real, IMAGE_HEADER_BYTES);
      const hint = await hintOf(real);
      const found = detect(head, formatHint(hint?.name ?? real, hint?.mime));
      const call = calls.getStore();
      if (call) call.plainText = found.route === 'text';
      if (found.route === 'image')
        return oversizeNote(found.id, head) ? null : formatOf(found.id).mime;
      return found.route === 'convert' ? (await result(real)).mime : null;
    },
  };
}

const NEWLINE = 0x0a;
const LINE_BREAK = Buffer.of(NEWLINE);

/** Whether `offset` (1-based, as `read` takes it) is the line just after the last of `text`. */
function isLineAfterLast(text: Buffer, offset: number | undefined): boolean {
  if (offset === undefined) return false;
  let lines = 1;
  // Counting stops once it reaches the offset, which then names a line of the text.
  for (let at = text.indexOf(NEWLINE); at !== -1 && lines < offset; lines += 1)
    at = text.indexOf(NEWLINE, at + 1);
  return offset === lines + 1;
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
