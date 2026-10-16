/**
 * Gives an ad hoc signature (`codesign --force -s -`) to each target-architecture slice in the pack
 * that has none. The linker signs arm64 output by itself but not x86_64, so most x64 addons and
 * tools arrive unsigned, and macOS will not load them. A slice that is already signed is never
 * re-signed, and one with a broken signature is left for the verification to reject.
 *
 * pnpm links package files from its content-addressed store, so a file is first replaced by a
 * copy of itself: signing in place would rewrite the store's file for every project using it.
 * `codesign` signs every slice of a universal file, so there the target slice is signed on its
 * own and put back with `lipo -replace`, leaving the other slices as they came.
 */
import { chmod, copyFile, rename, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { MACHO_ARCHS } from '../arch.mjs';
import { findMachO, signatureState, sliceArchs } from '../verify-app/macho.mjs';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr.trim()}`);
}

/** Signs `file`'s `machOArch` slice through a copy, then moves the copy over the original. */
async function signSlice(file, machOArch, universal) {
  const { mode } = await stat(file);
  const copy = `${file}.atd-sign`;
  // Named after the file itself, not the temporary copy codesign sees.
  const sign = (target) =>
    run('codesign', ['--force', '-s', '-', '-i', path.basename(file), target]);
  if (universal) {
    const slice = `${file}.atd-slice`;
    run('lipo', [file, '-thin', machOArch, '-output', slice]);
    sign(slice);
    run('lipo', [file, '-replace', machOArch, slice, '-output', copy]);
    await rm(slice);
  } else {
    await copyFile(file, copy);
    sign(copy);
  }
  await chmod(copy, mode);
  await rename(copy, file);
}

/** Signs the unsigned `arch` (a Node architecture name) slices under `roots`. */
export async function signUnsigned(roots, arch) {
  const machOArch = MACHO_ARCHS[arch];
  const signed = [];
  for (const { file } of await findMachO(roots)) {
    const archs = sliceArchs(file);
    if (!archs?.includes(machOArch) || signatureState(file, machOArch) !== 'unsigned') continue;
    await signSlice(file, machOArch, archs.length > 1);
    signed.push(file);
  }
  process.stdout.write(
    `Signed ${signed.length} unsigned native ${machOArch} binaries ad hoc${signed.length > 0 ? `:\n${signed.join('\n')}` : ''}\n`,
  );
}
