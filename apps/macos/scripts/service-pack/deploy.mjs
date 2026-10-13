/**
 * `pnpm deploy --prod --legacy` of the built service into the pack directory, so the bundle
 * carries production node_modules without applying files:["dist"]. The deploy must leave the
 * workspace as it found it:
 *
 * - The workspace lockfile is snapshotted and restored; a demanded lockfile write is a hard
 *   failure (do not keep it).
 * - pnpm < 12.7.0 also rewrites the source workspace's node_modules/.pnpm-workspace-state-v1.json
 *   during a legacy deploy, recording only the deployed project with production settings. The
 *   next `pnpm run` or `pnpm exec` in the workspace then sees stale state and reinstalls without
 *   devDependencies, emptying node_modules/.bin (pnpm/pnpm#15352). The state file is restored
 *   byte for byte after the deploy; drop that once the pinned pnpm includes the upstream fix.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

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

/** Returns the file's bytes, or null when it does not exist. */
async function readIfPresent(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Puts `file` back to a `readIfPresent` snapshot, removing it if it was absent. */
async function restoreSnapshot(file, bytes) {
  if (bytes === null) await rm(file, { force: true });
  else await writeFile(file, bytes, { mode: 0o600 });
}

/** Deploys `@atd/agent-service` into a fresh `packDir`; throws if the workspace would change. */
export async function deployService({ repoRoot, packDir }) {
  const lockFile = path.join(repoRoot, 'pnpm-lock.yaml');
  const lockBak = path.join(repoRoot, 'tmp', 't7-lockfile.bak');
  const workspaceState = path.join(repoRoot, 'node_modules', '.pnpm-workspace-state-v1.json');

  await mkdir(path.dirname(packDir), { recursive: true });
  await copyFile(lockFile, lockBak);
  const lockBefore = await hashFile(lockFile);
  const workspaceStateBefore = await readIfPresent(workspaceState);
  await rm(packDir, { recursive: true, force: true });

  const deploy = spawnSync(
    'pnpm',
    ['--filter', '@atd/agent-service', 'deploy', '--prod', '--legacy', packDir],
    { cwd: repoRoot, stdio: 'inherit', env: { ...process.env, npm_config_lockfile: 'false' } },
  );
  // Restore before any failure below so a failed deploy cannot leave it either.
  await restoreSnapshot(workspaceState, workspaceStateBefore);
  if ((await hashFile(lockFile)) !== lockBefore) {
    await copyFile(lockBak, lockFile);
    throw new Error(
      'pnpm deploy mutated pnpm-lock.yaml; restored snapshot. BLOCK: deploy demanded a workspace lockfile write.',
    );
  }
  if (deploy.status !== 0)
    throw new Error(`pnpm deploy exited with ${deploy.status ?? 'a signal'}.`);
}
