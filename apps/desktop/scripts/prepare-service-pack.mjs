#!/usr/bin/env node
/**
 * T7 packaging prepare: drop stale Electron worker outputs, then `pnpm deploy
 * --prod --legacy` the built service into gitignored tmp/ so extraResources
 * can copy production node_modules without applying files:["dist"].
 * The workspace lockfile is snapshotted and restored; a demanded lockfile
 * write is a hard failure (do not keep it).
 */
import { access, copyFile, mkdir, readdir, realpath, rm, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(desktopRoot, '../..');
const packDir = path.join(repoRoot, 'tmp', 't7-agent-service-pack');
const lockFile = path.join(repoRoot, 'pnpm-lock.yaml');
const lockBak = path.join(repoRoot, 'tmp', 't7-lockfile.bak');
const cli = path.join(repoRoot, 'apps', 'agent-service', 'dist', 'cli.js');
const contracts = path.join(repoRoot, 'packages', 'agent-contracts', 'dist', 'index.js');
const client = path.join(repoRoot, 'packages', 'agent-client', 'dist', 'index.js');
const distElectron = path.join(desktopRoot, 'dist-electron');

async function hashFile(file) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function clearStaleWorkers() {
  let names = [];
  try {
    names = await readdir(distElectron);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.startsWith('worker') && name.endsWith('.js'))
      .map((name) => unlink(path.join(distElectron, name))),
  );
}

for (const file of [cli, contracts, client]) {
  try {
    await access(file);
  } catch {
    process.stderr.write(`Missing built file ${file}. Run \`pnpm build\` before packaging.\n`);
    process.exit(1);
  }
}

await clearStaleWorkers();
await mkdir(path.dirname(packDir), { recursive: true });
await copyFile(lockFile, lockBak);
const lockBefore = await hashFile(lockFile);
await rm(packDir, { recursive: true, force: true });

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const deploy = spawnSync(
  pnpm,
  ['--filter', '@ai/agent-service', 'deploy', '--prod', '--legacy', packDir],
  { cwd: repoRoot, stdio: 'inherit', env: { ...process.env, npm_config_lockfile: 'false' } },
);
const lockAfter = await hashFile(lockFile);
if (lockAfter !== lockBefore) {
  await copyFile(lockBak, lockFile);
  process.stderr.write(
    'pnpm deploy mutated pnpm-lock.yaml; restored snapshot. BLOCK: deploy demanded a workspace lockfile write.\n',
  );
  process.exit(1);
}
if (deploy.status !== 0) process.exit(deploy.status ?? 1);

const stagedModules = path.join(packDir, 'node_modules');
try {
  await access(path.join(packDir, 'dist', 'cli.js'));
  await access(stagedModules);
} catch {
  process.stderr.write('pnpm deploy did not produce dist/cli.js + node_modules.\n');
  process.exit(1);
}

const piIndex = path.join(stagedModules, '@earendil-works', 'pi-coding-agent', 'dist', 'index.js');
try {
  await access(piIndex);
} catch {
  process.stderr.write(`Staged node_modules missing Pi at ${piIndex}\n`);
  process.exit(1);
}
const resolved = await realpath(piIndex);
if (!resolved.startsWith(packDir)) {
  process.stderr.write(`Staged Pi resolved outside pack (${resolved}).\n`);
  process.exit(1);
}
process.stdout.write(`Staged service pack at ${packDir}\nPi: ${resolved}\n`);
