import { clipboard, dialog } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CapabilityRequest, CapabilityResult, DesktopCapability } from '@ai/agent-contracts';
import type { AgentHttpClient } from '@ai/agent-client';
import SelectionHook from 'selection-hook';
import { handleFileSave } from './file-save';

const MAX_FILE_BYTES = 1024 * 1024;
const TEXT_EXTENSIONS = [
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
];

export interface CapabilityContext {
  http: () => AgentHttpClient | null;
  panelVisible: () => boolean;
  withDialog: <T>(operation: () => Promise<T>) => Promise<T>;
}

function denied(request: CapabilityRequest, error: string): CapabilityResult {
  return { requestId: request.id, revision: request.revision, ok: false, error };
}

function ok(request: CapabilityRequest, value: unknown): CapabilityResult {
  return { requestId: request.id, revision: request.revision, ok: true, value };
}

/**
 * Desktop capability handlers. Main executes the four ALLOWED types only;
 * unknown capabilities are rejected (no arbitrary Node/IPC/fs proxy).
 * Selection/clipboard reads are gated on panel visibility (user-action
 * context); file picks upload to the service and return resourceIds.
 */
export async function handleCapability(
  request: CapabilityRequest,
  ctx: CapabilityContext,
): Promise<CapabilityResult> {
  switch (request.capability as DesktopCapability) {
    case 'file.pick':
      return handleFilePick(request, ctx);
    case 'file.save':
      return handleFileSave(request, ctx);
    case 'selection.read':
      return handleSelection(request, ctx);
    case 'clipboard.read':
      return handleClipboardRead(request, ctx);
    case 'clipboard.write':
      return handleClipboardWrite(request);
    default:
      return denied(request, `Capability ${request.capability} is not served by this client.`);
  }
}

async function handleFilePick(
  request: CapabilityRequest,
  ctx: CapabilityContext,
): Promise<CapabilityResult> {
  const http = ctx.http();
  if (!http) return denied(request, 'The service connection is unavailable.');
  try {
    const picked = await ctx.withDialog(() =>
      dialog.showOpenDialog({
        title: 'Attach text files',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Text files', extensions: TEXT_EXTENSIONS }],
      }),
    );
    if (picked.canceled || !picked.filePaths.length)
      return denied(request, 'No file was selected.');
    if (picked.filePaths.length > 10) return denied(request, 'Attach at most 10 files.');
    const files: { resourceId: string; name: string; size: number; mime: string }[] = [];
    for (const filePath of picked.filePaths) {
      const info = await stat(filePath);
      if (!info.isFile() || info.size > MAX_FILE_BYTES)
        return denied(request, `${path.basename(filePath)} must be under 1 MB.`);
      const ext = path.extname(filePath).slice(1).toLowerCase();
      if (!TEXT_EXTENSIONS.includes(ext))
        return denied(request, `${path.basename(filePath)} is not a supported text file.`);
      const bytes = await readFile(filePath);
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (text.includes('\0')) throw new Error('binary');
      } catch {
        return denied(request, `${path.basename(filePath)} is not UTF-8 text.`);
      }
      const mime = ext === 'json' ? 'application/json' : 'text/plain';
      const uploaded = await http.upload(path.basename(filePath), mime, new Uint8Array(bytes));
      files.push({
        resourceId: uploaded.resource.id,
        name: path.basename(filePath),
        size: bytes.length,
        mime,
      });
    }
    return ok(request, { files });
  } catch (error) {
    return denied(
      request,
      error instanceof Error ? error.message : 'The file picker could not complete.',
    );
  }
}

let selectionHook: SelectionHook | null = null;

async function handleSelection(
  request: CapabilityRequest,
  ctx: CapabilityContext,
): Promise<CapabilityResult> {
  if (!ctx.panelVisible())
    return denied(request, 'Selection is only available while the panel is open.');
  try {
    selectionHook ??= new SelectionHook();
    if (!selectionHook.isRunning() && !selectionHook.start({ enableClipboard: false }))
      return denied(request, 'The selection could not be read.');
    const text = selectionHook.getCurrentSelection()?.text ?? '';
    selectionHook.stop();
    if (!text.trim()) return denied(request, 'No selected text is available.');
    if (text.length > 100000) return denied(request, 'Selected text exceeds the input limit.');
    return ok(request, { text, capturedAt: new Date().toISOString() });
  } catch (error) {
    return denied(
      request,
      error instanceof Error ? error.message : 'The selection could not be read.',
    );
  }
}

async function handleClipboardRead(
  request: CapabilityRequest,
  ctx: CapabilityContext,
): Promise<CapabilityResult> {
  if (!ctx.panelVisible())
    return denied(request, 'The clipboard is only available while the panel is open.');
  const text = await clipboard.readText();
  if (!text.trim()) return denied(request, 'The clipboard does not contain text.');
  if (text.length > 100000) return denied(request, 'Clipboard text exceeds the input limit.');
  return ok(request, { text, capturedAt: new Date().toISOString() });
}

async function handleClipboardWrite(request: CapabilityRequest): Promise<CapabilityResult> {
  const input = request.input as { text?: unknown } | null;
  const text = typeof input?.text === 'string' ? input.text : '';
  if (!text) return denied(request, 'Nothing to write to the clipboard.');
  if (text.length > 1000000) return denied(request, 'Clipboard content exceeds the limit.');
  clipboard.writeText(text);
  return ok(request, { ok: true });
}
