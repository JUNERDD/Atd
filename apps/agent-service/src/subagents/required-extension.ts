import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * T5 required child extension. The bridge is a REAL file path loaded into every
 * foreground child (the delegator registers it with pi-subagents for each parent
 * session); parent startup fails closed when the module file is missing. No
 * ambient trust escalation.
 */

export const REQUIRED_EXTENSION_ID = 'service.child-bridge';

export async function resolveRequiredExtensionPath(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, 'child-bridge.js'),
    path.join(here, 'child-bridge.ts'),
    path.join(here, '..', '..', 'dist', 'subagents', 'child-bridge.js'),
  ];
  // Prefer the compiled sibling when the service runs from dist; fall back to
  // the source sibling for tsx/dev. Every candidate must be a real file.
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return await realpath(candidate);
    } catch {
      continue;
    }
  }
  throw new Error('Required child extension is missing: no child-bridge module file exists.');
}
