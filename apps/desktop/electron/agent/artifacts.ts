import { app, clipboard, shell } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { downloadResource, type AgentClientOptions } from '@ai/agent-client';
import { writeDownloadedFile } from '../quarantine';
import { manageError } from './service-manage';
import type { FileRef } from './task-schema';

function safeName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 200) || 'download.bin';
}

/** Downloads an artifact into the app's downloads folder, then opens, reveals or copies it. */
export async function handleArtifact(
  options: AgentClientOptions,
  downloadsRoot: string,
  artifactId: string,
  operation: 'open' | 'reveal' | 'copy' | 'locate' | 'attach',
): Promise<FileRef | null> {
  try {
    const downloaded = await downloadResource(options, artifactId);
    const filePath = path.join(downloadsRoot, `${artifactId}-${safeName(downloaded.name)}`);
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
        await shell.openPath(filePath);
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
