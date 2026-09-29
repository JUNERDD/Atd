import type { AgentHttpClient } from '@ai/agent-client';
import type { FileRef } from '../../src/client/agent/task-schema';

/**
 * A file that passed the shared attachment rules (`@ai/agent-contracts`), held in memory until
 * upload. The desktop reads picked paths from disk (`attachable-files.ts`); the web client reads
 * browser `File`s.
 */
export interface AttachableUpload {
  /** The name the user picked. */
  name: string;
  mime: string;
  bytes: Uint8Array;
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
