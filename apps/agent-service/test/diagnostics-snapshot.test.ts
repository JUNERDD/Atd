import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { parse, ServiceDiagnosticsSnapshotSchema } from '@atd/agent-contracts';
import { prepareServe } from '../dist/config.js';
import {
  enforceSnapshotSizeCap,
  SNAPSHOT_MAX_BYTES,
} from '../dist/diagnostics/doctor-projections.js';
import {
  recordProviderErrorCategory,
  resetProviderErrorCategoriesForTests,
} from '../dist/diagnostics/doctor-providers.js';
import {
  getRunPrepDecisionRing,
  resetRunPrepDecisionRing,
} from '../dist/diagnostics/run-prep-ring.js';
import { buildServiceDiagnosticsSnapshot } from '../dist/diagnostics/snapshot-builder.js';
import { createLogger, getServiceLogRing, resetServiceLogRing } from '../dist/logging.js';
import { createSystemProxy } from '../dist/network/system-proxy.js';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  resetServiceLogRing();
  resetRunPrepDecisionRing();
  resetProviderErrorCategoriesForTests();
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('GET /v1/admin/diagnostics/snapshot conforms to ServiceDiagnosticsSnapshotSchema', async () => {
  installMemoryKeyring();
  const harness = await startTestService();
  try {
    const res = await harness.call('/v1/admin/diagnostics/snapshot');
    assert.equal(res.status, 200);
    const raw = await res.json();
    const snapshot = parse(ServiceDiagnosticsSnapshotSchema, raw);
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.service.serviceId, harness.config.serviceId);
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot), 'utf8') <= SNAPSHOT_MAX_BYTES);
  } finally {
    await harness.stop();
  }
});

test('Snapshot hashes connectionId, strips secrets/paths/prompts, and enforces <= 600 KiB cap', async () => {
  installMemoryKeyring();
  const dataDir = await makeTempDir('atd-snapshot-sec-');
  const log = createLogger('info');
  const config = await prepareServe({ flagDir: dataDir, host: '127.0.0.1', port: 0 });
  const systemProxy = await createSystemProxy(log);

  const secretConnId = ['conn', 'raw', 'uuid', '1234'].join('-');
  const sampleHome = ['/Users', 'alice'].join('/');
  const sampleSecret = ['sk', 'test', '99999'].join('-');
  const expectedHash = createHash('sha256').update(secretConnId).digest('hex').slice(0, 8);
  await mkdir(path.join(dataDir, 'providers'), { recursive: true });
  await writeFile(
    path.join(dataDir, 'providers', 'connections.json'),
    JSON.stringify({
      version: 1,
      defaultConnectionId: secretConnId,
      connections: [
        {
          connectionId: secretConnId,
          provider: 'openai-compatible',
          name: 'Internal Gateway',
          baseUrl: 'https://internal.corp.local/v1',
          authType: 'api_key',
          defaultModel: 'gpt-4o',
          revision: 1,
          connected: true,
          hasCredential: true,
          configurationId: 'cfg-1',
          verifiedModel: '',
          migratedAt: null,
        },
      ],
      defaultAliasId: null,
      aliases: [],
    }),
  );
  recordProviderErrorCategory(dataDir, secretConnId, 'tls_untrusted_ca');

  await mkdir(path.join(dataDir, 'mcp'), { recursive: true });
  await writeFile(
    path.join(dataDir, 'mcp', 'servers.json'),
    JSON.stringify({
      version: 1,
      servers: [
        {
          serverId: 'corp-mcp',
          revision: 1,
          connectionId: 'mcp-conn-1',
          transport: 'stdio',
          stdio: {
            command: 'node',
            args: ['server.js'],
            env: { CORP_API_KEY: 'super-secret-env-val' },
            cwd: null,
          },
          http: null,
          principal: 'user',
          isolateByTask: false,
          exposeResources: false,
          exposure: 'auto',
          approveTools: true,
          includeTools: [],
          excludeTools: [],
          requestTimeoutMs: null,
          disabled: false,
        },
      ],
    }),
  );

  const fakeLedger = {
    data: {
      tasks: [
        {
          id: 'task-1',
          title: 'CONFIDENTIAL_TITLE_DO_NOT_LEAK',
          createdAt: '2026-11-18T00:00:00.000Z',
          updatedAt: '2026-11-18T00:00:00.000Z',
          sessionFile: `${sampleHome}/private/session.jsonl`,
          rootTaskId: null,
          parentExecutionId: null,
          runs: [
            {
              id: 'run-abcdef1234',
              operationId: 'op-1',
              createdAt: '2026-11-18T00:01:00.000Z',
              status: 'failed',
              error: `Authorization: Bearer ${sampleSecret} failed at ${sampleHome}/secret`,
              snapshot: {
                input: {
                  text: 'TOP_SECRET_USER_PROMPT',
                  source: 'selection',
                  capturedAt: '2026-11-18T00:00:00.000Z',
                  selection: 'SECRET_SELECTION_BUFFER',
                  clipboard: 'SECRET_CLIPBOARD_BUFFER',
                  files: [],
                  arguments: {},
                },
                instructions: 'PRIVATE_CUSTOM_INSTRUCTIONS',
                model: {
                  connectionId: secretConnId,
                  modelId: 'gpt-4o',
                  provider: 'openai',
                  baseUrl: '',
                },
                tools: ['read'],
                memory: false,
              },
            },
          ],
        },
      ],
    },
  };

  getRunPrepDecisionRing().record({
    runId: 'run-abcdef1234',
    phase: 'plugins',
    outcome: 'degraded',
    reasonCode: 'plugin_timeout',
  });
  const ring = getServiceLogRing();
  for (let i = 0; i < 180; i += 1) {
    ring.push(
      JSON.stringify({
        ts: '2026-11-18T00:00:00.000Z',
        level: 'info',
        msg: `entry-${i}-${'x'.repeat(3500)}`,
      }),
    );
  }

  const snapshot = await buildServiceDiagnosticsSnapshot({
    config,
    systemProxy,
    ledger: fakeLedger as unknown as Parameters<
      typeof buildServiceDiagnosticsSnapshot
    >[0]['ledger'],
    confirms: { pending: () => [] } as unknown as Parameters<
      typeof buildServiceDiagnosticsSnapshot
    >[0]['confirms'],
    capabilities: { pending: () => [] } as unknown as Parameters<
      typeof buildServiceDiagnosticsSnapshot
    >[0]['capabilities'],
    computer: {
      coordinator: {
        hostStatus: () => ({ state: 'unavailable', profiles: [] }),
        inFlight: () => false,
      },
      bindings: { list: () => [] },
    } as unknown as Parameters<typeof buildServiceDiagnosticsSnapshot>[0]['computer'],
    addons: { list: () => [] } as unknown as Parameters<
      typeof buildServiceDiagnosticsSnapshot
    >[0]['addons'],
    manager: { isDraining: () => false, activeRunCount: () => 0 } as unknown as Parameters<
      typeof buildServiceDiagnosticsSnapshot
    >[0]['manager'],
    automations: {
      store: {
        problem: undefined,
        data: { definitions: { automations: [] }, state: { automations: {}, notices: [] } },
      },
    } as unknown as Parameters<typeof buildServiceDiagnosticsSnapshot>[0]['automations'],
    log,
    startedAt: '2026-11-18T00:00:00.000Z',
  });

  parse(ServiceDiagnosticsSnapshotSchema, snapshot);
  assert.equal(snapshot.providers[0]?.connectionIdHash, expectedHash);
  assert.equal(snapshot.providers[0]?.lastErrorCategory, 'tls_untrusted_ca');
  assert.deepEqual(snapshot.providers[0]?.baseUrlShape, {
    customHost: true,
    scheme: 'https',
    loopback: false,
  });
  assert.equal(snapshot.mcp.servers[0]?.envKeyCount, 1);
  assert.equal(snapshot.recentRuns[0]?.errorCategory, 'auth_required');
  assert.equal(snapshot.recentRuns[0]?.degradedFlags.pluginsDegraded, true);

  const json = JSON.stringify(snapshot);
  assert.ok(Buffer.byteLength(json, 'utf8') <= SNAPSHOT_MAX_BYTES);
  for (const forbidden of [
    secretConnId,
    config.token,
    'CONFIDENTIAL_TITLE_DO_NOT_LEAK',
    'TOP_SECRET_USER_PROMPT',
    'SECRET_SELECTION_BUFFER',
    'SECRET_CLIPBOARD_BUFFER',
    'PRIVATE_CUSTOM_INSTRUCTIONS',
    sampleSecret,
    'super-secret-env-val',
    'CORP_API_KEY',
    sampleHome,
  ]) {
    assert.ok(!json.includes(forbidden), `Snapshot must not contain ${forbidden}`);
  }

  // Explicitly verify enforceSnapshotSizeCap trims down an oversized snapshot > 600 KiB.
  const oversized = structuredClone(snapshot);
  oversized.boundedLogRing.lines = Array.from({ length: 200 }, () => 'y'.repeat(4000));
  enforceSnapshotSizeCap(oversized);
  assert.ok(Buffer.byteLength(JSON.stringify(oversized), 'utf8') <= SNAPSHOT_MAX_BYTES);
  parse(ServiceDiagnosticsSnapshotSchema, oversized);
});
