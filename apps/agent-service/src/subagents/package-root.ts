import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Where pi-subagents is installed, and the modules of its compiled tree the service loads. Since
 * 0.81 its exports map sends every entry to an esbuild bundle (`bundle/`), which keeps the child
 * session factory to itself and leaves out what patches/pi-subagents@<version>.patch changes:
 * that patch, like upstream's own child processes, targets the compiled tree (`index.js`, `src/`).
 * So the extension (`index.js`), its child-session module and its agent discovery load from that
 * tree as one module graph. The public subpath exports may stay bundled: their registries live on
 * `globalThis` under `Symbol.for` keys, which the bundle and the compiled tree share.
 */
let root: string | undefined;

/** The package directory. The exports map hides package.json, so it is found from the entry. */
export function subagentsPackageRoot(): string {
  if (root) return root;
  let dir = path.dirname(fileURLToPath(import.meta.resolve('pi-subagents')));
  while (!isSubagentsPackage(dir)) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('pi-subagents has no package directory.');
    dir = parent;
  }
  root = dir;
  return dir;
}

function isSubagentsPackage(dir: string): boolean {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return false;
  }
  return typeof manifest === 'object' && manifest !== null && 'name' in manifest
    ? manifest.name === 'pi-subagents'
    : false;
}

/** The file URL `import()` takes for a module of the compiled tree, such as `index.js`. */
export function subagentsModuleUrl(...segments: string[]): string {
  return pathToFileURL(path.join(subagentsPackageRoot(), ...segments)).href;
}
