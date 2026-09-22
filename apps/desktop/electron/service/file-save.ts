import { dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CapabilityRequest, CapabilityResult } from '@ai/agent-contracts';

export interface FileSaveContext {
  withDialog: <T>(operation: () => Promise<T>) => Promise<T>;
}

function denied(request: CapabilityRequest, error: string): CapabilityResult {
  return { requestId: request.id, revision: request.revision, ok: false, error };
}

function ok(request: CapabilityRequest, value: unknown): CapabilityResult {
  return { requestId: request.id, revision: request.revision, ok: true, value };
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Desktop `file.save`: save dialog + write. Returns name/size only (no local
 * path), matching file.pick's privacy posture.
 */
export async function handleFileSave(
  request: CapabilityRequest,
  ctx: FileSaveContext,
): Promise<CapabilityResult> {
  const input = request.input as { name?: unknown; mime?: unknown; contentBase64?: unknown } | null;
  const name = typeof input?.name === 'string' ? input.name : '';
  const contentBase64 = typeof input?.contentBase64 === 'string' ? input.contentBase64 : '';
  if (!name.trim() || name.length > 255) return denied(request, 'Enter a file name.');
  if (!contentBase64 || contentBase64.length > 700000)
    return denied(request, 'The file content is missing or too large to save over the desktop.');
  if (contentBase64.length % 4 !== 0 || !BASE64.test(contentBase64))
    return denied(request, 'file.save content is not valid base64.');
  let bytes: Buffer;
  try {
    bytes = Buffer.from(contentBase64, 'base64');
  } catch {
    return denied(request, 'file.save content is not valid base64.');
  }
  try {
    const picked = await ctx.withDialog(() =>
      dialog.showSaveDialog({
        title: 'Save file',
        defaultPath: path.basename(name),
      }),
    );
    if (picked.canceled || !picked.filePath) return denied(request, 'The save was cancelled.');
    await writeFile(picked.filePath, bytes);
    return ok(request, { saved: true, name: path.basename(picked.filePath), size: bytes.length });
  } catch (error) {
    return denied(request, error instanceof Error ? error.message : 'The file could not be saved.');
  }
}
