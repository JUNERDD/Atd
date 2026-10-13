/**
 * The Mach-O rules every native binary the app ships must meet, read with the Command Line Tools
 * (`lipo`, `codesign`, `vtool`):
 *
 * - it carries a slice for the target architecture (universal binaries such as Sparkle pass);
 * - that slice has a valid signature. The app's signature seals everything under Resources by
 *   hash but does not sign nested code, and macOS refuses to load an unsigned binary on Apple
 *   silicon, so each binary must arrive signed (a linker signature counts);
 * - it requires no newer macOS than the app's `LSMinimumSystemVersion`, read from
 *   `LC_BUILD_VERSION` or the older `LC_VERSION_MIN_MACOSX`.
 *
 * Fat files share their magic with Java class files; one `lipo` cannot read fails unless it is a
 * class file.
 */
import { lstat, open, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const MAGICS = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'cafebabf']);

async function header(file) {
  const handle = await open(file);
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(8), 0, 8, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Every regular file under `roots` (files or directories) that starts with a Mach-O or fat magic.
 * Symbolic links are skipped: their targets are scanned where they live.
 */
export async function findMachO(roots) {
  const found = [];
  const consider = async (file) => {
    const bytes = await header(file);
    if (bytes.length >= 4 && MAGICS.has(bytes.subarray(0, 4).toString('hex')))
      found.push({ file, bytes });
  };
  for (const root of roots) {
    const stat = await lstat(root);
    if (stat.isFile()) {
      await consider(root);
      continue;
    }
    for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) await consider(path.join(entry.parentPath, entry.name));
    }
  }
  return found;
}

/** The architectures of a Mach-O or fat file, or null when `lipo` cannot read it. */
export function sliceArchs(file) {
  const run = spawnSync('lipo', ['-archs', file], { encoding: 'utf8' });
  return run.status === 0 ? run.stdout.trim().split(/\s+/) : null;
}

/** A class file's major version (bytes 6–7) is 45 or more; a fat header's slice count is tiny. */
function isJavaClass(bytes) {
  return bytes.length >= 8 && bytes.subarray(0, 4).toString('hex') === 'cafebabe'
    ? bytes.readUInt16BE(6) >= 45
    : false;
}

/** `valid`, `unsigned` (no signature at all) or `invalid` for one slice of `file`. */
export function signatureState(file, machOArch) {
  const run = spawnSync('codesign', ['--verify', '--strict', '--arch', machOArch, file], {
    encoding: 'utf8',
  });
  if (run.status === 0) return 'valid';
  return run.stderr.includes('not signed at all') ? 'unsigned' : 'invalid';
}

/** The minimum macOS one slice declares, or null when it declares none. */
export function minimumSystem(file, machOArch) {
  const run = spawnSync('vtool', ['-arch', machOArch, '-show-build', file], { encoding: 'utf8' });
  if (run.status !== 0) return null;
  for (const block of run.stdout.split(/^Load command \d+$/m)) {
    const field = (name) => new RegExp(`^\\s*${name} (\\S+)$`, 'm').exec(block)?.[1];
    if (field('cmd') === 'LC_BUILD_VERSION' && field('platform') === 'MACOS') return field('minos');
    if (field('cmd') === 'LC_VERSION_MIN_MACOSX') return field('version');
  }
  return null;
}

/** Compares dotted versions such as `10.15` and `15.0.0` numerically. */
export function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Applies the Mach-O rules for `machOArch` to every Mach-O under `roots`; `maxMinos` (the app's
 * `LSMinimumSystemVersion`) is checked when given. Throws listing every violation, otherwise
 * returns how many binaries passed.
 */
export async function checkMachO(roots, { machOArch, maxMinos }) {
  const violations = [];
  let checked = 0;
  for (const { file, bytes } of await findMachO(roots)) {
    const archs = sliceArchs(file);
    if (archs === null) {
      if (!isJavaClass(bytes)) violations.push(`${file}: not a Mach-O file lipo can read`);
      continue;
    }
    checked += 1;
    if (!archs.includes(machOArch)) {
      violations.push(`${file}: no ${machOArch} slice (has ${archs.join(', ')})`);
      continue;
    }
    const signature = signatureState(file, machOArch);
    if (signature !== 'valid') violations.push(`${file}: ${machOArch} slice is ${signature}`);
    if (maxMinos === undefined) continue;
    const minos = minimumSystem(file, machOArch);
    if (minos === null) violations.push(`${file}: declares no minimum macOS`);
    else if (compareVersions(minos, maxMinos) > 0)
      violations.push(`${file}: requires macOS ${minos}, above the app's ${maxMinos}`);
  }
  if (violations.length > 0)
    throw new Error(`Native code breaks the Mach-O rules:\n${violations.join('\n')}`);
  return checked;
}
