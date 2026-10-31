import { open, readFile, stat } from 'node:fs/promises';
import { MAX_ATTACHMENT_BYTES } from '@atd/agent-contracts';
import { describeFile } from './describe.js';
import { capText } from './document.js';
import { formatHint, formatOf } from './formats.js';
import { IMAGE_HEADER_BYTES, oversizeNote } from './image-size.js';
import type { FileHint, FileLoader, LoadedFile, LoadFileOptions } from './loader.js';
import { detect } from './sniff.js';
import { decodeText, startsAsUtf8Text, TEXT_SAMPLE_BYTES } from './text.js';

const MIB = 1024 * 1024;
/** The prefix of a large text file in another encoding that is decoded: past `capText`'s limit in any encoding. */
const LARGE_TEXT_PREFIX_BYTES = 32 * MIB;

/**
 * Loads a file on disk, hinted by `hint` or else by its path. One up to `MAX_ATTACHMENT_BYTES` is
 * read whole and handed to `load`. One past it is sniffed by its start: an image passes whole as
 * image input, UTF-8 text passes through whole (as `read` always read it), text in another
 * encoding is decoded from a prefix and cut, and anything else is described without being parsed.
 */
export async function loadPath(
  file: string,
  load: FileLoader['load'],
  { hint, ...options }: { hint?: FileHint } & LoadFileOptions = {},
): Promise<LoadedFile> {
  const name = hint?.name ?? file;
  const { size } = await stat(file);
  if (size <= MAX_ATTACHMENT_BYTES) {
    const bytes = await readFile(file);
    return load({ bytes, name, ...(hint?.mime === undefined ? {} : { mime: hint.mime }) }, options);
  }
  const head = await readStart(file, IMAGE_HEADER_BYTES);
  const found = detect(head, formatHint(name, hint?.mime));
  const format = formatOf(found.id);
  if (found.route === 'image') {
    const oversize = oversizeNote(found.id, head);
    if (oversize) return { kind: 'text', text: describeFile(format, size, undefined, [oversize]) };
    return { kind: 'image', mime: format.mime, bytes: await readFile(file) };
  }
  if (found.route === 'text') {
    if (startsAsUtf8Text(head.subarray(0, TEXT_SAMPLE_BYTES)))
      return { kind: 'utf8', bytes: await readFile(file) };
    const prefix = await readStart(file, LARGE_TEXT_PREFIX_BYTES);
    const decoded = decodeText(prefix);
    if (decoded?.utf8) return { kind: 'text', text: capText(Buffer.from(prefix).toString('utf8')) };
    if (decoded) return decodedText(capText(decoded.text), found.id);
  }
  const note = `Files over ${MAX_ATTACHMENT_BYTES / MIB} MB are not converted.`;
  return { kind: 'text', text: describeFile(format, size, undefined, [note]) };
}

/**
 * The text of a file in an encoding other than UTF-8, decoded: the file's own content, which an
 * extraction entry keeps for grep (loader.ts `TextContent`), labeled by format `id` when the file
 * has one and as plain text otherwise.
 */
export function decodedText(text: string, id: string): LoadedFile {
  return { kind: 'text', text, content: { format: id ? formatOf(id).label : 'Text file' } };
}

/** The first `length` bytes of a file, or all of a shorter one. */
export async function readStart(file: string, length: number): Promise<Uint8Array> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
