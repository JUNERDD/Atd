import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  attachableExtension,
  attachableMime,
  attachmentByteLimit,
  isImageExtension,
  MAX_ATTACHMENT_BYTES,
  type AttachableExtension,
  type ResourceImportFailureReason,
} from '@atd/agent-contracts';

const MIB = 1024 * 1024;

/** A file that passed the attachment rules, held in memory until it is stored. */
export interface AttachableFile {
  /** The basename of the path the caller named. */
  name: string;
  mime: string;
  bytes: Uint8Array;
  /** The resolved path every rule was checked against and the bytes were read from. */
  realPath: string;
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
 * Resolves links before any rule runs, so the regular-file, extension and size checks apply to
 * the file that is actually read. Rejections carry only the basename: Node's fs errors embed the
 * absolute path, so they are replaced rather than forwarded.
 */
export async function readAttachable(filePath: string): Promise<AttachableFile> {
  const name = path.basename(filePath);
  const unreadable = (): never => {
    throw new AttachableRejected('unreadable', `${name} could not be read.`);
  };
  // Names the limit of the file's own format; a path that is not a regular file has no format yet.
  const tooLarge = (extension?: AttachableExtension) => {
    const image = extension !== undefined && isImageExtension(extension);
    const limit = (extension ? attachmentByteLimit(extension) : MAX_ATTACHMENT_BYTES) / MIB;
    return new AttachableRejected(
      'tooLarge',
      `${name} must be ${image ? 'an image' : 'a text file'} smaller than ${limit} MB.`,
    );
  };
  const realPath = await realpath(filePath).catch(unreadable);
  const info = await stat(realPath).catch(unreadable);
  const extension = attachableExtension(realPath);
  if (!info.isFile()) throw tooLarge();
  if (!extension) throw new AttachableRejected('unsupported', `${name} is not supported.`);
  const limit = attachmentByteLimit(extension);
  if (info.size > limit) throw tooLarge(extension);
  const bytes = await readFile(realPath).catch(unreadable);
  // The file can grow between stat and read; the limit applies to the bytes that are stored.
  if (bytes.length > limit) throw tooLarge(extension);
  return { name, realPath, mime: attachableMime(extension), bytes: new Uint8Array(bytes) };
}
