import type { AgentHttpClient } from '@ai/agent-client';
import type { FileRef } from './task-schema';

/**
 * Attachment rules every client applies before uploading: which text formats the service reads
 * back as run material, how many files one message takes, and how large each may be. The desktop
 * reads picked paths from disk (`attachable-files.ts`); the web client reads browser `File`s.
 */

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
export const MAX_ATTACHMENTS = 10;
/** Largest file main reads for one attachment, well under the service's 8 MiB resource cap. */
export const MAX_ATTACHMENT_BYTES = 1024 * 1024;

/** A validated file held in memory until upload. */
export interface AttachableUpload {
  /** The name the user picked or saw in search results. */
  name: string;
  mime: string;
  bytes: Uint8Array;
}

/** The attachable format of a file name or path, by its last extension. */
export function attachableExtension(name: string): AttachableExtension | undefined {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const extension = base.slice(dot + 1).toLowerCase();
  return ATTACHABLE_EXTENSIONS.find((candidate) => candidate === extension);
}

/** The media type an attachment is uploaded with. */
export function attachableMime(extension: AttachableExtension): string {
  return extension === 'json' ? 'application/json' : 'text/plain';
}

/** Uploads without a task id; the service ledger lets any later run reference the resource. */
export async function uploadAttachables(
  http: Pick<AgentHttpClient, 'upload'>,
  files: AttachableUpload[],
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
