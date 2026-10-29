import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  attachmentMime,
  MAX_ATTACHMENT_BYTES,
  type ResourceImportFailureReason,
} from '@atd/agent-contracts';

const MIB = 1024 * 1024;

/** A file that passed the attachment rules, held in memory until it is stored. */
export interface AttachableFile {
  /** The basename of the path the caller named. */
  name: string;
  /** The media type the resource is stored with, by `name`. */
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
 * Reads a file under the attachment rules: any regular file of at most `MAX_ATTACHMENT_BYTES`,
 * whatever its format. Links are resolved before any rule runs, so the regular-file and size
 * checks apply to the file that is actually read. Rejections carry only the basename: Node's fs
 * errors embed the absolute path, so they are replaced rather than forwarded.
 */
export async function readAttachable(filePath: string): Promise<AttachableFile> {
  const name = path.basename(filePath);
  const unreadable = (): never => {
    throw new AttachableRejected('unreadable', `${name} could not be read.`);
  };
  const tooLarge = () =>
    new AttachableRejected(
      'tooLarge',
      `${name} is larger than the ${MAX_ATTACHMENT_BYTES / MIB} MB attachment limit.`,
    );
  const realPath = await realpath(filePath).catch(unreadable);
  const info = await stat(realPath).catch(unreadable);
  if (!info.isFile())
    throw new AttachableRejected('unsupported', `${name} is not a file that can be attached.`);
  if (info.size > MAX_ATTACHMENT_BYTES) throw tooLarge();
  const bytes = await readFile(realPath).catch(unreadable);
  // The file can grow between stat and read; the limit applies to the bytes that are stored.
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw tooLarge();
  // Kept as read: a copy would hold the file in memory twice.
  return { name, realPath, mime: attachmentMime(name), bytes };
}
