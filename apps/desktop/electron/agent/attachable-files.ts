import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AgentHttpClient } from '@ai/agent-client';
import {
  attachableExtension,
  attachableMime,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  uploadAttachables,
  type AttachableUpload,
} from './attachable-rules';
import type { FileRef } from './task-schema';

/** A picked file read from disk. `realPath` stays in main. */
export interface AttachableFile extends AttachableUpload {
  /** The resolved path every rule was checked against and the bytes were read from. */
  realPath: string;
}

/**
 * Resolves links before any rule runs, so the regular-file, extension and size checks apply to the
 * file that is actually read. Errors name only the basename; absolute paths never reach the
 * renderer.
 */
export async function readAttachable(filePath: string): Promise<AttachableFile> {
  const name = path.basename(filePath);
  // Node's fs errors embed the absolute path, so they are replaced rather than forwarded.
  const unreadable = () => {
    throw new Error(`${name} could not be read.`);
  };
  const tooLarge = () => new Error(`${name} must be a text file smaller than 1 MB.`);
  const realPath = await realpath(filePath).catch(unreadable);
  const info = await stat(realPath).catch(unreadable);
  if (!info.isFile() || info.size > MAX_ATTACHMENT_BYTES) throw tooLarge();
  const extension = attachableExtension(realPath);
  if (!extension) throw new Error(`${name} is not supported.`);
  const bytes = await readFile(realPath).catch(unreadable);
  // The file can grow between stat and read; the limit applies to the bytes that are uploaded.
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw tooLarge();
  return { name, realPath, mime: attachableMime(extension), bytes: new Uint8Array(bytes) };
}

/**
 * Attaches paths the user picked in the native chooser. Every file is validated and read before
 * the first upload, so a rejected file leaves no partial uploads behind.
 */
export async function attachFiles(
  http: Pick<AgentHttpClient, 'upload'>,
  filePaths: string[],
): Promise<FileRef[]> {
  if (filePaths.length > MAX_ATTACHMENTS)
    throw new Error(`Attach at most ${MAX_ATTACHMENTS} files.`);
  const files: AttachableFile[] = [];
  for (const filePath of filePaths) files.push(await readAttachable(filePath));
  return uploadAttachables(http, files);
}
