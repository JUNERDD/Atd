import { dialog } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ContextFile } from './contract';

export async function chooseContextFiles(): Promise<ContextFile[]> {
  // An unattached modal avoids macOS moving the panel to make room for a sheet.
  const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
  if (result.canceled) return [];
  return Promise.all(
    result.filePaths.map(async (filePath) => {
      const file = await stat(filePath);
      if (!file.isFile()) throw new Error('Choose a regular file');
      // Native selection supplies no MIME type. Only metadata crosses into the renderer.
      return { name: path.basename(filePath), size: file.size, type: '' };
    }),
  );
}
