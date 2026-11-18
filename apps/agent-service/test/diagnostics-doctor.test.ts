import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { DoctorRunResponseSchema, parse, type ServiceConnection } from '@atd/agent-contracts';
import { resetAddonLockDiagnosticsForTests } from '../dist/addons/lock.js';
import { prepareServe } from '../dist/config.js';
import { defaultProviderEndpointProbe } from '../dist/diagnostics/doctor-probes.js';
import { classifyProviderFailure } from '../dist/diagnostics/doctor-projections.js';
import { resetProviderErrorCategoriesForTests } from '../dist/diagnostics/doctor-providers.js';
import { runServiceDoctor } from '../dist/diagnostics/doctor-runner.js';
import { createLogger } from '../dist/logging.js';
import { resetLoginShellPathDiagnosticsForTests } from '../dist/login-shell-path.js';
import { __resetLaunchKeyCacheForTests } from '../dist/mcp/launch-key.js';
import { MemoryIndex } from '../dist/memory/index-db.js';
import { createSystemProxy } from '../dist/network/system-proxy.js';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeDoctorDeps(
  config: Awaited<ReturnType<typeof prepareServe>>,
  systemProxy: Awaited<ReturnType<typeof createSystemProxy>>,
  log: ReturnType<typeof createLogger>,
): Parameters<typeof runServiceDoctor>[0] {
  return {
    config,
    systemProxy,
    addons: { list: () => [] } as unknown as Parameters<typeof runServiceDoctor>[0]['addons'],
    automations: {
      store: {
        problem: undefined,
        data: { definitions: { automations: [] }, state: { automations: {}, notices: [] } },
      },
    } as unknown as Parameters<typeof runServiceDoctor>[0]['automations'],
    log,
  };
}

afterEach(async () => {
  __resetLaunchKeyCacheForTests();
  resetAddonLockDiagnosticsForTests();
  resetProviderErrorCategoriesForTests();
  resetLoginShellPathDiagnosticsForTests();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await chmod(dir, 0o755).catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('route manifest exposes POST /v1/diagnostics/run as renderer and GET /v1/admin/diagnostics/snapshot as shell', async () => {
  installMemoryKeyring();
  const harness = await startTestService();
  try {
    const res = await harness.call('/v1/admin/routes');
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      routes: Array<{ method: string; pathPattern: string; exposure: string }>;
    };
    const doctorRoute = body.routes.find(
      (r) => r.method === 'POST' && r.pathPattern === '/v1/diagnostics/run',
    );
    const snapshotRoute = body.routes.find(
      (r) => r.method === 'GET' && r.pathPattern === '/v1/admin/diagnostics/snapshot',
    );
    assert.deepEqual(doctorRoute, {
      method: 'POST',
      pathPattern: '/v1/diagnostics/run',
      exposure: 'renderer',
    });
    assert.deepEqual(snapshotRoute, {
      method: 'GET',
      pathPattern: '/v1/admin/diagnostics/snapshot',
      exposure: 'shell',
    });

    const diagRes = await harness.call('/v1/diagnostics/run', { method: 'POST', body: '{}' });
    assert.equal(diagRes.status, 200);
    const diagBody = parse(DoctorRunResponseSchema, await diagRes.json());
    assert.equal(diagBody.includeConnectivity, false);
    assert.ok(diagBody.durationMs <= 2_200);
    const mirror = diagBody.checks.find((c) => c.id === 'conn.mirror_tls_and_clock_skew');
    const endpoints = diagBody.checks.find((c) => c.id === 'conn.provider_endpoints');
    assert.equal(mirror?.status, 'skipped');
    assert.equal(mirror?.reasonCode, 'not_requested');
    assert.equal(endpoints?.status, 'skipped');
    assert.equal(endpoints?.reasonCode, 'not_requested');
  } finally {
    await harness.stop();
  }
});

test('Doctor finishes <= 2200ms, skips Folder TCC paths, avoids PRAGMA quick_check, and avoids modal keyring prompt', async () => {
  const keyring = installMemoryKeyring();
  const dataDir = await makeTempDir('atd-doctor-data-');
  const home = await makeTempDir('atd-doctor-home-');
  const tccPaths = [
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'Downloads'),
    path.join(home, 'Library', 'Mobile Documents'),
  ];
  for (const p of tccPaths) {
    await mkdir(p, { recursive: true });
    await chmod(p, 0o000);
  }

  try {
    const log = createLogger('info');
    const config = await prepareServe({ flagDir: dataDir, host: '127.0.0.1', port: 0 });
    const systemProxy = await createSystemProxy(log);
    await mkdir(path.join(dataDir, 'security'), { recursive: true });
    await writeFile(
      path.join(dataDir, 'security', 'launch-approvals.json'),
      JSON.stringify({
        version: 1,
        approvals: [
          {
            serverId: 'srv-1',
            kind: 'mcp-stdio',
            fingerprint: 'abc',
            approvedAt: '2026-11-18T00:00:00Z',
          },
        ],
        notice: false,
      }),
    );
    keyring.state.fail = (op, acc) => op === 'get' && acc === 'security:launch-approval-key';

    const dbPath = path.join(config.paths.agentDir, 'memory', 'index.db');
    await mkdir(path.dirname(dbPath), { recursive: true });
    const memIndex = MemoryIndex.open(dbPath, () => undefined);

    const started = performance.now();
    const res = await runServiceDoctor(
      makeDoctorDeps(config, systemProxy, log),
      { includeConnectivity: false },
      {
        homeDir: home,
        // Simulate a slow binary probe to ensure the 2,200 ms runner wall-clock cap holds.
        probeBinary: () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true, version: '1.0', errorKind: null }), 5_000),
          ),
        resolveRg: async () => '/usr/bin/rg',
        probeFileIndex: async () => ({ ok: true, loadErrorCode: null }),
      },
    );
    const elapsed = performance.now() - started;
    memIndex.close();

    assert.ok(elapsed <= 2_200, `Expected Doctor <= 2200ms, got ${elapsed}ms`);
    assert.ok(res.durationMs <= 2_200);
    const keychain = res.checks.find((c) => c.id === 'perm.keychain_and_launch_key');
    assert.equal(keychain?.status, 'fail');
    assert.equal(keychain?.reasonCode, 'launch_approval_key_unreadable');
    const serialized = JSON.stringify(res);
    assert.ok(!serialized.includes(home));
    for (const p of tccPaths) await chmod(p, 0o755);
  } finally {
    keyring.state.fail = () => false;
    for (const p of tccPaths) await chmod(p, 0o755).catch(() => undefined);
  }
});

test('Doctor detects clock skew, provider errors, and MCP required launcher failures', async () => {
  installMemoryKeyring();
  const dataDir = await makeTempDir('atd-doctor-conn-');
  const log = createLogger('info');
  const config = await prepareServe({ flagDir: dataDir, host: '127.0.0.1', port: 0 });
  const systemProxy = await createSystemProxy(log);

  await mkdir(path.join(dataDir, 'mcp'), { recursive: true });
  await mkdir(path.join(dataDir, 'providers'), { recursive: true });
  const srv = {
    serverId: 'local-npx',
    revision: 1,
    connectionId: 'conn-1',
    transport: 'stdio',
    stdio: { command: 'npx', args: ['-y', 'demo'], env: {}, cwd: null },
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
  };
  const conn = {
    connectionId: 'prov-1',
    provider: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'api_key',
    defaultModel: 'gpt-4o',
    revision: 1,
    connected: true,
    hasCredential: true,
    configurationId: 'cfg-1',
    verifiedModel: 'gpt-4o',
    migratedAt: null,
  };
  await writeFile(
    path.join(dataDir, 'mcp', 'servers.json'),
    JSON.stringify({ version: 1, servers: [srv] }),
  );
  await writeFile(
    path.join(dataDir, 'providers', 'connections.json'),
    JSON.stringify({
      version: 1,
      defaultConnectionId: 'prov-1',
      connections: [conn],
      defaultAliasId: null,
      aliases: [],
    }),
  );

  let skewMs = 400_000;
  const server = createServer((_req, res) => {
    res.writeHead(200, { Date: new Date(Date.now() + skewMs).toUTCString() });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const mirrorUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/`;

  try {
    const deps = makeDoctorDeps(config, systemProxy, log);
    const resFail = await runServiceDoctor(
      deps,
      { includeConnectivity: true },
      {
        mirrorUrl,
        probeBinary: async (cmd) =>
          cmd === 'npx'
            ? { ok: false, version: null, errorKind: 'missing' }
            : { ok: true, version: '1.0', errorKind: null },
        probeProviderEndpoint: async () => ({ ok: false, status: 401 }),
        probeFileIndex: async () => ({ ok: true, loadErrorCode: null }),
      },
    );
    assert.equal(
      resFail.checks.find((c) => c.id === 'conn.mirror_tls_and_clock_skew')?.reasonCode,
      'clock_skew_gt_300s',
    );
    assert.equal(
      resFail.checks.find((c) => c.id === 'conn.provider_endpoints')?.reasonCode,
      'provider_auth_failed',
    );
    assert.equal(
      resFail.checks.find((c) => c.id === 'shell.host_cli_tools')?.reasonCode,
      'mcp_required_launcher_missing',
    );

    skewMs = 180_000;
    const resWarn = await runServiceDoctor(
      deps,
      { includeConnectivity: true },
      {
        mirrorUrl,
        probeBinary: async () => ({ ok: true, version: '1.0', errorKind: null }),
        probeProviderEndpoint: async () => ({ ok: true, status: 200 }),
        probeFileIndex: async () => ({ ok: true, loadErrorCode: null }),
      },
    );
    assert.equal(
      resWarn.checks.find((c) => c.id === 'conn.mirror_tls_and_clock_skew')?.reasonCode,
      'clock_skew_gt_120s',
    );
    assert.equal(resWarn.checks.find((c) => c.id === 'conn.provider_endpoints')?.status, 'pass');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('defaultProviderEndpointProbe and classifyProviderFailure distinguish auth 401 and public vs LAN reachability', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(401);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/v1`;
  try {
    const baseConn = {
      connectionId: 'c-1',
      provider: 'openai',
      name: 'Test',
      baseUrl,
      defaultModel: 'gpt-4o',
      revision: 1,
      connected: true,
      hasCredential: true,
      configurationId: 'cfg',
      verifiedModel: '',
      migratedAt: null,
    } satisfies Omit<ServiceConnection, 'authType'>;

    const authed = await defaultProviderEndpointProbe(
      { ...baseConn, authType: 'api_key' },
      AbortSignal.timeout(1000),
    );
    assert.deepEqual(authed, { ok: true, status: 401 });

    const unauthed = await defaultProviderEndpointProbe(
      { ...baseConn, authType: 'none' },
      AbortSignal.timeout(1000),
    );
    assert.deepEqual(unauthed, { ok: false, status: 401 });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  for (const [code, url, expected] of [
    [
      'ENETUNREACH',
      'https://api.openai.com/v1',
      { reason: 'provider_tls_or_proxy_failed', category: 'enetunreach' },
    ],
    [
      'EHOSTUNREACH',
      'http://192.168.1.50:11434/v1',
      { reason: 'local_network_permission_denied', category: 'local_network_denied' },
    ],
    [
      'EACCES',
      'http://mac-studio.local:11434/v1',
      { reason: 'local_network_permission_denied', category: 'local_network_denied' },
    ],
  ] as const) {
    const res = classifyProviderFailure(undefined, Object.assign(new Error('net'), { code }), url);
    assert.deepEqual(res, expected);
  }
});
