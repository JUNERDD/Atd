import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import {
  getAddonLockDiagnostics,
  loadAddonCatalog,
  resetAddonLockDiagnosticsForTests,
} from '../dist/addons/lock.js';
import { AutomationEngine } from '../dist/automations/engine.js';
import type { EngineDeps } from '../dist/automations/engine-deps.js';
import {
  extractNativeIndexLoadErrors,
  getLastNativeIndexLoadErrors,
  NativeIndexBackend,
  openNativeIndex,
  probeNativeIndexAddon,
  resetNativeIndexLoadErrorsForTests,
} from '../dist/file-search/native-index.js';
import type { Logger } from '../dist/logging.js';
import {
  __resetLaunchKeyCacheForTests,
  launchApprovalKeyState,
  launchKey,
  probeLaunchApprovalKeyState,
  readLaunchKey,
  rotateLaunchKeyOnApproval,
} from '../dist/mcp/launch-key.js';
import { getMemoryIndexDiagnostics, MemoryIndex } from '../dist/memory/index-db.js';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

const noopLog: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  __resetLaunchKeyCacheForTests();
  resetNativeIndexLoadErrorsForTests();
  resetAddonLockDiagnosticsForTests();
  delete process.env.AI_ADDONS_LOCK;
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

test('native-index preserves structured, path-scrubbed loadErrors on addon load failure', async () => {
  const home = homedir();
  const rootCause = Object.assign(
    new Error(`dlopen(${home}/Library/Application Support/Atd/file-index.node, 0x0001): EBADARCH`),
    { code: 'ERR_DLOPEN_FAILED' },
  );
  const topError = Object.assign(new Error('Cannot find native binding'), {
    code: 'MODULE_NOT_FOUND',
    cause: rootCause,
  });

  const extracted = extractNativeIndexLoadErrors(topError);
  assert.equal(extracted.length, 2);
  assert.equal(extracted[0]!.code, 'MODULE_NOT_FOUND');
  assert.equal(extracted[1]!.code, 'ERR_DLOPEN_FAILED');
  assert.ok(!extracted[1]!.message.includes(home));

  const dir = await makeTempDir('atd-native-index-');
  const backend = new NativeIndexBackend(dir, noopLog, (targetDir) =>
    openNativeIndex(targetDir, async () => {
      throw topError;
    }),
  );
  const reply = await backend.search({
    query: 'notes',
    limit: 5,
    signal: new AbortController().signal,
  });
  assert.deepEqual(reply, { state: 'unavailable', reason: 'unsupported' });

  const diag = backend.diagnosticsStatus();
  assert.equal(diag.state, 'unsupported');
  assert.equal(diag.loadErrorCode, 'module_not_found');
  assert.equal(diag.loadErrors.length, 2);
  assert.ok(!JSON.stringify(diag).includes(home));
  assert.equal(getLastNativeIndexLoadErrors().loadErrors.length, 2);

  const probe = await probeNativeIndexAddon(async () => {
    throw rootCause;
  });
  assert.equal(probe.ok, false);
  assert.equal(probe.loadErrorCode, 'err_dlopen_failed');
  assert.equal(probe.loadErrors.length, 1);
  await backend.close();
});

test('MemoryIndex diagnosticsStatus returns O(1) state without PRAGMA quick_check', async () => {
  const dir = await makeTempDir('atd-memory-diag-');
  const dbPath = path.join(dir, 'index.db');
  const index = MemoryIndex.open(dbPath, () => undefined);
  assert.equal(index.diagnosticsStatus().storageMode, 'disk');
  assert.equal(index.diagnosticsStatus().fallbackInMemory, false);
  assert.equal(index.diagnosticsStatus().rebuiltAtStartup, false);
  assert.equal(index.diagnosticsStatus().unitCount, 0);
  assert.deepEqual(getMemoryIndexDiagnostics(dbPath), index.diagnosticsStatus());

  index.sync([
    {
      id: 'unit-1',
      revision: 'rev-1',
      name: 'Alpha',
      description: 'Test memory',
      type: 'memory',
      category: 'insight',
      activation: 'search',
      enabled: true,
      source: 'user',
      origin: null,
      reviewed: true,
      created: '2026-11-18T00:00:00.000Z',
      updated: '2026-11-18T00:00:00.000Z',
      body: 'Body content',
    },
  ]);
  assert.equal(index.diagnosticsStatus().unitCount, 1);
  index.close();
  assert.equal(getMemoryIndexDiagnostics(dbPath), null);
});

test('launch-key passive getter and non-interactive probe track all states safely', async () => {
  const keyring = installMemoryKeyring();
  const serviceId = 'svc-launch-key-test';
  assert.equal(launchApprovalKeyState(serviceId, { hasSavedApprovals: false }), 'not_created');
  assert.equal(
    await probeLaunchApprovalKeyState(serviceId, { hasSavedApprovals: false }),
    'not_created',
  );

  await launchKey(serviceId);
  assert.equal(launchApprovalKeyState(serviceId), 'readable');

  __resetLaunchKeyCacheForTests();
  keyring.set(serviceId, 'security:launch-approval-key', Buffer.from('short').toString('base64'));
  await assert.rejects(readLaunchKey(serviceId), /malformed/);
  assert.equal(launchApprovalKeyState(serviceId), 'malformed');

  const rotated = await rotateLaunchKeyOnApproval(serviceId);
  assert.equal(rotated.length, 32);
  assert.equal(launchApprovalKeyState(serviceId), 'readable');

  __resetLaunchKeyCacheForTests();
  keyring.state.fail = (op, account) => op === 'get' && account === 'security:launch-approval-key';
  try {
    await assert.rejects(readLaunchKey(serviceId));
    assert.equal(launchApprovalKeyState(serviceId), 'unreadable');
  } finally {
    keyring.state.fail = () => false;
  }
});

test('addons/lock and automations/engine expose passive readonly diagnostics', async () => {
  const dir = await makeTempDir('atd-addon-lock-');
  const lockFile = path.join(dir, 'addons.lock.json');
  process.env.AI_ADDONS_LOCK = lockFile;

  await writeFile(lockFile, '{corrupt-lock', 'utf8');
  await loadAddonCatalog({ development: false, log: noopLog });
  const badDiag = getAddonLockDiagnostics();
  assert.equal(badDiag.status, 'invalid');
  assert.equal(badDiag.errorCode, 'addons_lock_invalid_json');

  await writeFile(
    lockFile,
    JSON.stringify({
      schemaVersion: 1,
      addons: [
        {
          id: 'computer-browser',
          arch: process.arch === 'arm64' ? 'arm64' : 'x64',
          version: '1.0.0',
          size: 123,
          unpackedSize: 456,
          sha256: 'a'.repeat(64),
          urls: ['https://downloads.atd.best/addon.tar.gz'],
        },
      ],
    }),
    'utf8',
  );
  await loadAddonCatalog({ development: false, log: noopLog });
  const okDiag = getAddonLockDiagnostics();
  assert.equal(okDiag.status, 'ok');
  assert.equal(okDiag.artifactCount, 1);

  const fakeDeps = {
    store: {
      problem: null,
      data: { definitions: { automations: [] }, state: { automations: {}, notices: [] } },
      idle: async () => undefined,
      change: async () => undefined,
    },
    ledger: { tasks: () => [] },
    events: { onPublish: () => () => undefined },
    manager: { subscribe: () => () => undefined },
    folders: { list: () => [] },
    snapshots: {},
    paths: { root: dir },
    log: noopLog,
    now: () => 1_700_000_000_000,
    changed: () => undefined,
    activity: { idleSeconds: () => 0 },
    consolidateMemory: async () => undefined,
    launchCommand: async () => ({ taskId: 't', runId: 'r' }),
  } as unknown as EngineDeps;
  const engine = new AutomationEngine(fakeDeps);
  assert.deepEqual(engine.diagnosticsStatus(), {
    running: false,
    lastTickAt: null,
    inWakeGrace: false,
    failingCount: 0,
    activeFolderScans: 0,
    storeProblem: false,
  });
});

test('server-routes preserves all registered /v1 routes', async () => {
  const harness = await startTestService();
  try {
    const res = await harness.call('/v1/admin/routes');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { routes: Array<{ pathPattern: string }> };
    const patterns = new Set(body.routes.map((r) => r.pathPattern));
    assert.ok(patterns.has('/v1/status'));
    assert.ok(patterns.has('/v1/tasks'));
    assert.ok(patterns.has('/v1/skills'));
    assert.ok(patterns.has('/v1/addons'));
    assert.ok(patterns.has('/v1/automations'));
    assert.ok(patterns.has('/v1/mcp/status'));
  } finally {
    await harness.stop();
  }
});
