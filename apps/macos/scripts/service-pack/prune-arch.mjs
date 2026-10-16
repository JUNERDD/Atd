/**
 * Removes native code the app can never load on its architecture: pi-tui ships its clipboard
 * addon prebuilt for every platform inside the package (not as optional dependencies, which pnpm
 * installs for the host only), and the file index package may hold addons from other builds. The
 * verification requires every Mach-O in the pack to carry the target architecture, so a leftover
 * fails there; a package layout these rules no longer match fails here.
 */
import { access, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { MACHO_ARCHS } from '../arch.mjs';
import { PI_TUI, fileIndexAddon, piTuiAddon, storeCopies } from '../verify-app/pack-layout.mjs';

/** Prunes the pack at `packRoot` down to `arch` (a Node architecture name). */
export async function pruneForArch(packRoot, arch) {
  const others = Object.keys(MACHO_ARCHS).filter((name) => name !== arch);
  const removed = [];
  const remove = async (target) => {
    if (
      await access(target).then(
        () => true,
        () => false,
      )
    ) {
      await rm(target, { recursive: true });
      removed.push(path.relative(packRoot, target));
    }
  };

  const piTuiCopies = await storeCopies(packRoot, PI_TUI);
  if (piTuiCopies.length === 0) throw new Error(`The pack has no ${PI_TUI} to prune.`);
  for (const dir of piTuiCopies) {
    const kept = path.join(dir, piTuiAddon(arch));
    await access(kept).catch(() => {
      throw new Error(`${PI_TUI} no longer ships ${piTuiAddon(arch)} (${dir}).`);
    });
    for (const other of others) await remove(path.dirname(path.join(dir, piTuiAddon(other))));
    await remove(path.join(dir, 'native', 'linux'));
    await remove(path.join(dir, 'native', 'win32'));
  }

  const fileIndex = await realpath(path.join(packRoot, 'node_modules', '@atd', 'file-index'));
  // Never delete from the workspace package itself.
  if (!fileIndex.startsWith(`${await realpath(packRoot)}${path.sep}`))
    throw new Error(`@atd/file-index resolves outside the pack (${fileIndex}).`);
  for (const name of await readdir(fileIndex)) {
    if (/^file-index\..+\.node$/.test(name) && name !== fileIndexAddon(arch))
      await remove(path.join(fileIndex, name));
  }
  process.stdout.write(
    `Pruned native code for other platforms than darwin-${arch}: ${removed.join(', ') || 'none'}\n`,
  );
}
