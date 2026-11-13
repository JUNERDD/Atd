import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { WPS_SELECTION } from './layout.mjs';

/** The small WPS-owned page; it uses the existing service and starts no helper process. */
export async function wpsSelectionPayload({ repoRoot }) {
  const root = path.join(repoRoot, 'apps/agent-service/addons/wps-selection');
  const files = await Promise.all(
    ['index.html', 'main.js', 'ribbon.xml'].map(async (file) => ({
      path: file,
      data: await readFile(path.join(root, file)),
      executable: false,
    })),
  );
  return {
    id: WPS_SELECTION,
    version: '1.0.0',
    entries: { index: 'index.html', script: 'main.js', ribbon: 'ribbon.xml' },
    files,
  };
}
