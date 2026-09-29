import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  attachableExtension,
  attachableMime,
  MAX_ATTACHMENT_BYTES,
  type ResourceImportFailureReason,
} from '@ai/agent-contracts';

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
  const tooLarge = () =>
    new AttachableRejected('tooLarge', `${name} must be a text file smaller than 1 MB.`);
  const realPath = await realpath(filePath).catch(unreadable);
  const info = await stat(realPath).catch(unreadable);
  if (!info.isFile() || info.size > MAX_ATTACHMENT_BYTES) throw tooLarge();
  const extension = attachableExtension(realPath);
  if (!extension) throw new AttachableRejected('unsupported', `${name} is not supported.`);
  const bytes = await readFile(realPath).catch(unreadable);
  // The file can grow between stat and read; the limit applies to the bytes that are stored.
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw tooLarge();
  return { name, realPath, mime: attachableMime(extension), bytes: new Uint8Array(bytes) };
}
