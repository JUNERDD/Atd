/**
 * Where the service pack keeps the native code the packaging and its verification both look at.
 * A pack is a `pnpm deploy --legacy` of `@atd/agent-service`: direct dependencies are links under
 * `node_modules`, and every package copy lives in the virtual store `node_modules/.pnpm/<id>`.
 */
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

export const PI_TUI = '@earendil-works/pi-tui';
export const ESBUILD = 'esbuild';

/** The file index addon for one Node architecture (packages/file-index). */
export function fileIndexAddon(arch) {
  return `file-index.darwin-${arch}.node`;
}

/** The pi-tui clipboard addon its loader picks by `${platform}-${arch}`, relative to the package. */
export function piTuiAddon(arch) {
  return path.join('native', 'darwin', 'prebuilds', `darwin-${arch}`, 'darwin-platform.node');
}

/** Every copy of package `name` in the pack's virtual store (one per resolved version). */
export async function storeCopies(packRoot, name) {
  const store = path.join(packRoot, 'node_modules', '.pnpm');
  const copies = [];
  for (const entry of await readdir(store)) {
    const dir = path.join(store, entry, 'node_modules', ...name.split('/'));
    const stat = await lstat(dir).catch(() => null);
    if (stat?.isDirectory()) copies.push(dir);
  }
  return copies;
}
