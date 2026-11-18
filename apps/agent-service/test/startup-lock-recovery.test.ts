import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  acquireLock,
  getConfigRecoveryState,
  prepareServe,
  releaseLock,
  resetConfigRecoveryStateForTests,
} from '../dist/config.js';
import { servicePaths } from '../dist/storage.js';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(packageRoot, 'dist', 'cli.js');
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  resetConfigRecoveryStateForTests();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

test('acquireLock recovers from malformed/corrupt service.lock instead of throwing SyntaxError', async () => {
  const root = await makeTempDir('atd-corrupt-lock-');
  const paths = servicePaths(root);
  await mkdir(root, { recursive: true });

  await writeFile(paths.lockFile, '{corrupt-json', 'utf8');
  await acquireLock(paths);
  assert.equal(getConfigRecoveryState().corruptLockRecovered, true);
  const rewritten = JSON.parse(await readFile(paths.lockFile, 'utf8')) as { pid: number };
  assert.equal(rewritten.pid, process.pid);

  await releaseLock(paths);
  resetConfigRecoveryStateForTests();

  await writeFile(paths.lockFile, JSON.stringify({ version: 99, pid: 123 }), 'utf8');
  await acquireLock(paths);
  assert.equal(getConfigRecoveryState().corruptLockRecovered, true);
  await releaseLock(paths);
});

test(
  'acquireLock guards against same-UID PID reuse when lock PID belongs to a non-service process',
  { skip: process.platform === 'win32' },
  async () => {
    const root = await makeTempDir('atd-pid-reuse-');
    const paths = servicePaths(root);
    const sleeper = spawn('/bin/sleep', ['15'], { stdio: 'ignore' });
    try {
      assert.ok(sleeper.pid);
      await writeFile(
        paths.lockFile,
        JSON.stringify({
          version: 1,
          pid: sleeper.pid,
          startedAt: new Date().toISOString(),
        }),
        'utf8',
      );
      await acquireLock(paths);
      assert.equal(getConfigRecoveryState().staleLockReclaimed, true);
      const lock = JSON.parse(await readFile(paths.lockFile, 'utf8')) as { pid: number };
      assert.equal(lock.pid, process.pid);
      await releaseLock(paths);
    } finally {
      sleeper.kill('SIGKILL');
    }
  },
);

test('prepareServe recovers corrupt service.json and rotates mismatched/corrupt auth/token', async () => {
  const root = await makeTempDir('atd-state-heal-');
  const paths = servicePaths(root);
  await mkdir(path.dirname(paths.tokenFile), { recursive: true });
  await writeFile(paths.serviceFile, '{not-valid-service-json', 'utf8');
  await writeFile(
    paths.tokenFile,
    JSON.stringify({
      version: 1,
      serviceId: '00000000-0000-4000-8000-000000000000',
      token: 'stale-token-value-with-32-chars-minimum',
      createdAt: '2025-01-01T00:00:00.000Z',
    }),
    'utf8',
  );

  const config = await prepareServe({ flagDir: root, host: '127.0.0.1', port: 0 });
  const recovery = getConfigRecoveryState();
  assert.equal(recovery.serviceFileRecreated, true);
  assert.equal(recovery.tokenRotated, true);
  assert.equal(config.epoch, 1);

  const tokenFile = JSON.parse(await readFile(paths.tokenFile, 'utf8')) as {
    serviceId: string;
    token: string;
  };
  assert.equal(tokenFile.serviceId, config.serviceId);
  assert.equal(tokenFile.token, config.token);
  assert.notEqual(tokenFile.token, 'stale-token-value-with-32-chars-minimum');
  await releaseLock(paths);

  await writeFile(paths.tokenFile, 'corrupt-token-file', 'utf8');
  resetConfigRecoveryStateForTests();
  const second = await prepareServe({ flagDir: root, host: '127.0.0.1', port: 0 });
  assert.equal(getConfigRecoveryState().tokenRotated, true);
  assert.notEqual(second.token, config.token);
  await releaseLock(paths);
});

test('cli serve contention does NOT delete live owner service.lock and scrubs personal paths from stderr', async () => {
  const root = await makeTempDir('atd-cli-contention-');
  const paths = servicePaths(root);
  await acquireLock(paths);
  const originalLock = await readFile(paths.lockFile, 'utf8');

  let exitCode = 0;
  let stderr = '';
  try {
    await execFileAsync(process.execPath, [cliPath, 'serve', '--dataDir', root], {
      env: { ...process.env, AI_AGENT_DATA_DIR: '' },
    });
  } catch (error) {
    const err = error as { code?: number; stderr?: string };
    exitCode = err.code ?? 1;
    stderr = err.stderr ?? '';
  }

  assert.equal(exitCode, 1);
  assert.match(stderr, /Another agent service \(pid/);
  const afterLock = await readFile(paths.lockFile, 'utf8');
  assert.equal(afterLock, originalLock, 'contention must never delete live service.lock');

  const home = homedir();
  const fakeHomeChild = path.join(home, '.atd-nonexistent-diagnostic-check');
  let statusStderr = '';
  try {
    await execFileAsync(process.execPath, [cliPath, 'status', '--dataDir', fakeHomeChild], {
      env: { ...process.env, AI_AGENT_DATA_DIR: '' },
    });
  } catch (error) {
    statusStderr = (error as { stderr?: string }).stderr ?? '';
  }
  assert.ok(!statusStderr.includes(home), 'fatal stderr must scrub home directory');
  assert.ok(!/\/Users\/(?!<user>)[A-Za-z0-9._-]+/.test(statusStderr));

  await releaseLock(paths);
});
