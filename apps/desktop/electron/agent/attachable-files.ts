import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AgentHttpClient } from '@ai/agent-client';
import type { FileRef } from './task-schema';

/** Text formats the service reads back as UTF-8 run material. */
export const ATTACHABLE_EXTENSIONS = [
  'txt',
  'md',
  'csv',
  'json',
  'log',
  'yaml',
  'yml',
  'xml',
  'html',
  'css',
  'ts',
  'tsx',
  'js',
  'py',
] as const;
export type AttachableExtension = (typeof ATTACHABLE_EXTENSIONS)[number];

/** Files per message; `InputSchema.files` accepts the same number. */
const MAX_ATTACHMENTS = 10;
/** Largest file main reads for one attachment, well under the service's 8 MiB resource cap. */
export const MAX_ATTACHMENT_BYTES = 1024 * 1024;

/** A validated file held in memory until upload. `realPath` stays in main. */
export interface AttachableFile {
  /** The requested path's basename: the name the user picked or saw in search results. */
  name: string;
  /** The resolved path every rule was checked against and the bytes were read from. */
  realPath: string;
  mime: string;
  bytes: Uint8Array;
}

export function attachableExtension(filePath: string): AttachableExtension | undefined {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return ATTACHABLE_EXTENSIONS.find((candidate) => candidate === extension);
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
  const mime = extension === 'json' ? 'application/json' : 'text/plain';
  return { name, realPath, mime, bytes: new Uint8Array(bytes) };
}

/** Uploads without a task id; the service ledger lets any later run reference the resource. */
export async function uploadAttachables(
  http: Pick<AgentHttpClient, 'upload'>,
  files: AttachableFile[],
): Promise<FileRef[]> {
  const refs: FileRef[] = [];
  for (const file of files) {
    const uploaded = await http.upload(file.name, file.mime, file.bytes);
    refs.push({
      id: uploaded.resource.id,
      name: file.name,
      size: file.bytes.length,
      type: file.mime,
    });
  }
  return refs;
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
