import { app, clipboard, shell } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { downloadResource, type AgentClientOptions } from '@ai/agent-client';
import type { Confirm } from '../confirm-dialog';
import { writeDownloadedFile } from '../quarantine';
import { opensWithoutAsking, safeFileName } from './artifact-open-policy';
import { manageError } from './service-manage';
import type { FileRef } from './task-schema';

const SHOW_IN_FOLDER = 0;
const OPEN_ANYWAY = 1;
const CANCEL = 2;

/**
 * Opens a downloaded artifact. Document types open directly; any other type can run code on
 * macOS, so the user chooses between revealing it (the default), opening it anyway, or neither.
 */
async function openDownloaded(filePath: string, confirm: Confirm): Promise<void> {
  const name = path.basename(filePath);
  if (opensWithoutAsking(name)) {
    await shell.openPath(filePath);
    return;
  }
  const mac = process.platform === 'darwin';
  const choice = await confirm({
    message: `Open “${name}”?`,
    detail: `This file type can run code on your ${mac ? 'Mac' : 'computer'}. Open it only if you trust where it came from.`,
    buttons: [mac ? 'Show in Finder' : 'Show in Folder', 'Open Anyway', 'Cancel'],
    defaultId: SHOW_IN_FOLDER,
    cancelId: CANCEL,
  });
  if (choice === SHOW_IN_FOLDER) shell.showItemInFolder(filePath);
  else if (choice === OPEN_ANYWAY) await shell.openPath(filePath);
}

/** Downloads an artifact into the app's downloads folder, then opens, reveals or copies it. */
export async function handleArtifact(
  options: AgentClientOptions,
  downloadsRoot: string,
  confirm: Confirm,
  artifactId: string,
  operation: 'open' | 'reveal' | 'copy' | 'locate' | 'attach',
): Promise<FileRef | null> {
  try {
    const downloaded = await downloadResource(options, artifactId);
    const filePath = path.join(downloadsRoot, `${artifactId}-${safeFileName(downloaded.name)}`);
    await mkdir(downloadsRoot, { recursive: true });
    await writeDownloadedFile(filePath, downloaded.bytes, app.name);
    const file: FileRef = {
      id: artifactId,
      name: downloaded.name,
      size: downloaded.bytes.length,
      type: downloaded.mime,
    };
    switch (operation) {
      case 'open':
        await openDownloaded(filePath, confirm);
        return file;
      case 'reveal':
      case 'locate':
        shell.showItemInFolder(filePath);
        return file;
      case 'copy':
        clipboard.writeText(filePath);
        return file;
      case 'attach':
        return file;
      default: {
        const _exhaustive: never = operation;
        throw new Error(`Unsupported artifact operation: ${String(_exhaustive)}`);
      }
    }
  } catch (error) {
    manageError(error);
  }
}
