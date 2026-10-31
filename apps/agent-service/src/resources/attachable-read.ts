import { readFile, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  attachmentMime,
  MAX_ATTACHMENT_BYTES,
  type ResourceImportFailureReason,
  type ResourceSource,
} from '@atd/agent-contracts';

const MIB = 1024 * 1024;

/** A path that passed the attachment rules on what `stat` says; its bytes are read separately. */
export interface InspectedFile {
  /** The basename of the path the caller named. */
  name: string;
  /** The resolved path every rule was checked against and the bytes are read from. */
  realPath: string;
  /**
   * The file and its version as inspected, which import dedupe and refresh at send compare.
   * Absent for a file in the system temporary directory: the shell stages screenshots and pasted
   * images there and removes them after the import, so they are no source to read again.
   */
  source?: ResourceSource;
}

/** A file that passed the attachment rules, held in memory until it is stored. */
export interface AttachableFile {
  /** The basename of the path the caller named. */
  name: string;
  /** The media type `name` suggests; the store settles the stored one from the content. */
  mime: string;
  bytes: Uint8Array;
  /** The resolved path every rule was checked against and the bytes were read from. */
  realPath: string;
  /** Where the bytes came from (`InspectedFile.source`), for the store to keep. */
  source?: ResourceSource;
}

/** A file the attachment rules refused; the message names only its basename. */
export class AttachableRejected extends Error {
  constructor(
    readonly reason: ResourceImportFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'AttachableRejected';
  }
}

/**
 * Checks a path under the attachment rules without reading it: any regular file of at most
 * `MAX_ATTACHMENT_BYTES`, whatever its format. Links are resolved before any rule runs, so the
 * regular-file and size checks apply to the file that is actually read. Rejections carry only the
 * basename: Node's fs errors embed the absolute path, so they are replaced rather than forwarded.
 */
export async function inspectAttachable(filePath: string): Promise<InspectedFile> {
  const name = path.basename(filePath);
  const realPath = await realpath(filePath).catch(() => unreadable(name));
  const info = await stat(realPath).catch(() => unreadable(name));
  if (!info.isFile())
    throw new AttachableRejected('unsupported', `${name} is not a file that can be attached.`);
  if (info.size > MAX_ATTACHMENT_BYTES) throw tooLarge(name);
  const { size, mtimeMs, ctimeMs, ino } = info;
  const staged = inside(await temporaryRoot(), realPath);
  return {
    name,
    realPath,
    ...(staged ? {} : { source: { path: realPath, size, mtimeMs, ctimeMs, ino } }),
  };
}

/** The bytes of an inspected file, under the same rules. */
export async function readInspected(file: InspectedFile): Promise<Uint8Array> {
  const bytes = await readFile(file.realPath).catch(() => unreadable(file.name));
  // The file can grow between stat and read; the limit applies to the bytes that are stored.
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw tooLarge(file.name);
  // Kept as read: a copy would hold the file in memory twice.
  return bytes;
}

/** Reads a file under the attachment rules (`inspectAttachable`, then `readInspected`). */
export async function readAttachable(filePath: string): Promise<AttachableFile> {
  const file = await inspectAttachable(filePath);
  const bytes = await readInspected(file);
  return {
    name: file.name,
    realPath: file.realPath,
    mime: attachmentMime(file.name),
    bytes,
    ...(file.source ? { source: file.source } : {}),
  };
}

function unreadable(name: string): never {
  throw new AttachableRejected('unreadable', `${name} could not be read.`);
}

function tooLarge(name: string): AttachableRejected {
  return new AttachableRejected(
    'tooLarge',
    `${name} is larger than the ${MAX_ATTACHMENT_BYTES / MIB} MB attachment limit.`,
  );
}

let temporary: Promise<string> | undefined;

/** The system temporary directory as a real path (on macOS, `/var` resolves to `/private/var`). */
function temporaryRoot(): Promise<string> {
  temporary ??= realpath(tmpdir()).catch(() => path.resolve(tmpdir()));
  return temporary;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
