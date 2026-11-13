import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeHostArch } from '../../macos/scripts/arch.mjs';
import { ADDON_IDS, LOCK_FILE } from '../../macos/scripts/addons/layout.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEV_ADDONS_DIR = path.join(REPO_ROOT, 'tmp', 'addons');
const RECEIPT_FILE = path.join(DEV_ADDONS_DIR, 'dev-addons-receipt.json');

const byLexicalOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files.sort(byLexicalOrder);
}

async function computeFingerprint(arch) {
  const hash = createHash('sha256');
  hash.update(`arch:${arch}\n`);

  const inputDirs = [
    path.join(REPO_ROOT, 'apps', 'macos', 'scripts', 'addons'),
    path.join(REPO_ROOT, 'apps', 'agent-service', 'addons'),
  ];
  const inputFiles = [
    ...(await Promise.all(inputDirs.map((dir) => collectFiles(dir)))).flat(),
    path.join(REPO_ROOT, 'apps', 'agent-service', 'dist', 'computer', 'worker', 'server.js'),
    path.join(
      REPO_ROOT,
      'apps',
      'agent-service',
      'node_modules',
      'playwright-core',
      'package.json',
    ),
  ].sort(byLexicalOrder);

  for (const file of inputFiles) {
    const rel = path.relative(REPO_ROOT, file);
    const bytes = await readFile(file).catch(() => null);
    hash.update(`file:${rel}:${bytes ? bytes.length : 'missing'}\n`);
    if (bytes) hash.update(bytes);
  }
  return hash.digest('hex');
}

async function isLockValid(arch) {
  try {
    const raw = await readFile(path.join(DEV_ADDONS_DIR, LOCK_FILE), 'utf8');
    const lock = JSON.parse(raw);
    if (!Array.isArray(lock?.addons)) return false;
    const byId = new Map(lock.addons.map((item) => [item.id, item]));
    for (const id of ADDON_IDS) {
      const entry = byId.get(id);
      if (!entry || entry.arch !== arch || !Array.isArray(entry.urls) || entry.urls.length === 0) {
        return false;
      }
      for (const url of entry.urls) {
        if (url.startsWith('file://')) {
          await access(fileURLToPath(url));
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function isCacheCurrent(fingerprint, arch) {
  try {
    const receipt = JSON.parse(await readFile(RECEIPT_FILE, 'utf8'));
    if (receipt?.fingerprint !== fingerprint || receipt?.arch !== arch) return false;
    return await isLockValid(arch);
  } catch {
    return false;
  }
}

/**
 * Ensures `tmp/addons/addons.lock.json` and its archives are up to date in development on macOS.
 * Uses an input-content receipt so unchanged runs skip packing in a few milliseconds.
 */
export async function ensureDevAddons() {
  if (process.platform !== 'darwin') return;
  if (process.env.AI_ADDONS_LOCK?.trim()) return;

  const arch = nativeHostArch();
  const fingerprint = await computeFingerprint(arch);
  if (await isCacheCurrent(fingerprint, arch)) return;

  process.stdout.write('[dev] Packing development add-ons...\n');
  const result = spawnSync('pnpm', ['--filter', '@atd/macos', 'addons:pack'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.stderr.write(
      `[dev] Failed to pack development add-ons (exit ${result.status ?? 'unknown'}); continuing without updating tmp/addons.\n`,
    );
    return;
  }

  await writeFile(RECEIPT_FILE, `${JSON.stringify({ arch, fingerprint }, null, 2)}\n`);
}
