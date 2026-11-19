import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { prepareServe } from '../dist/config.js';
import {
  __setKeyringModuleForTests,
  KeyringBackend,
  keyringServiceName,
} from '../dist/credentials/keyring.js';
import { cacheStatus, withKeyringGate } from '../dist/credentials/keyring-cache.js';
import { probeKeyringPassive } from '../dist/diagnostics/doctor-probes.js';
import { readMcpPassiveSummary } from '../dist/diagnostics/doctor-projections.js';
import { runServiceDoctor } from '../dist/diagnostics/doctor-runner.js';
import {
  NativeIndexBackend,
  openNativeIndex,
  resetNativeIndexLoadErrorsForTests,
} from '../dist/file-search/native-index.js';
import { createLogger } from '../dist/logging.js';
import { createSystemProxy } from '../dist/network/system-proxy.js';
import { installMemoryKeyring } from './memory-keyring.ts';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const baseMcpFields = {
  revision: 1,
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

afterEach(async () => {
  resetNativeIndexLoadErrorsForTests();
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('B1: readMcpPassiveSummary handles { keyring: true } HTTP headers without throwing or touching Keychain', async () => {
  installMemoryKeyring();
  const dataDir = await makeTempDir('atd-b1-mcp-');
  const log = createLogger('info');
  await mkdir(path.join(dataDir, 'mcp'), { recursive: true });
  await writeFile(
    path.join(dataDir, 'mcp', 'servers.json'),
    JSON.stringify({
      version: 1,
      servers: [
        {
          ...baseMcpFields,
          serverId: 'http-keyring-only',
          connectionId: 'c1',
          transport: 'streamable-http',
          stdio: null,
          http: {
            url: 'https://mcp.example.com/v1',
            transport: 'streamable-http',
            headers: { Authorization: { keyring: true } },
            auth: { type: 'none' },
          },
        },
        {
          ...baseMcpFields,
          serverId: 'http-keyring-plus-env',
          connectionId: 'c2',
          transport: 'sse',
          stdio: null,
          http: {
            url: 'https://mcp.example.com/sse',
            transport: 'sse',
            headers: { Authorization: { keyring: true }, 'X-Workspace': '${ATD_WS}' },
            auth: { type: 'none' },
          },
        },
        {
          ...baseMcpFields,
          serverId: 'http-bearer-env',
          connectionId: 'c3',
          transport: 'streamable-http',
          stdio: null,
          http: {
            url: 'https://mcp.example.com/v2',
            transport: 'streamable-http',
            headers: { 'X-Key': { keyring: true } },
            auth: { type: 'bearer', tokenEnv: 'MCP_BEARER_TOKEN' },
          },
        },
      ],
    }),
  );

  const summary = await readMcpPassiveSummary('svc-b1', dataDir, log);
  assert.equal(summary.servers.length, 3);
  assert.equal(summary.servers[0]!.approval, 'notRequired');
  assert.equal(summary.servers[0]!.headerKeyCount, 1);
  assert.equal(summary.servers[1]!.approval, 'required');
  assert.equal(summary.servers[1]!.headerKeyCount, 2);
  assert.equal(summary.servers[2]!.approval, 'required');
});

test('B2: probeKeyringPassive never mutates keyring and never enters or wedges withKeyringGate', async () => {
  const mutations: string[] = [];
  let releaseGate!: () => void;
  const gateBlocker = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  __setKeyringModuleForTests({
    AsyncEntry: class {
      private readonly account: string;
      constructor(_service: string, account: string) {
        this.account = account;
      }
      async setPassword(): Promise<void> {
        mutations.push(`set:${this.account}`);
        await new Promise(() => undefined);
      }
      async getPassword(): Promise<string | undefined> {
        return 'secret-val';
      }
      async deleteCredential(): Promise<boolean> {
        mutations.push(`del:${this.account}`);
        return true;
      }
    },
  });

  const heldGate = withKeyringGate(() => gateBlocker);
  const status = await probeKeyringPassive('svc-b2');
  assert.equal(status.available, true);
  assert.deepEqual(mutations, [], 'probeKeyringPassive must perform zero set/delete mutations');
  releaseGate();
  await heldGate;

  __setKeyringModuleForTests(undefined);
  cacheStatus(keyringServiceName('svc-b2-cached'), {
    available: true,
    backend: 'keychain',
    detail: 'cached',
  });
  const fromCache = await probeKeyringPassive('svc-b2-cached');
  assert.equal(fromCache.detail, 'cached');

  if (process.platform === 'darwin') {
    const darwinPassive = await probeKeyringPassive('svc-b2-uncached');
    assert.equal(typeof darwinPassive.available, 'boolean');
  }

  const mem = installMemoryKeyring();
  mem.set('svc-b2', 'acc-1', 'v1');
  assert.equal(await new KeyringBackend('svc-b2').get('acc-1'), 'v1');
});

test('B12, B13, B26: Doctor handles explicit MCP paths, uvx, external-volume file index, and valid docsUrl', async () => {
  installMemoryKeyring();
  const dataDir = await makeTempDir('atd-b12-b13-b26-');
  const log = createLogger('info');
  const config = await prepareServe({ flagDir: dataDir, host: '127.0.0.1', port: 0 });
  const systemProxy = await createSystemProxy(log);

  await mkdir(path.join(dataDir, 'mcp'), { recursive: true });
  await writeFile(
    path.join(dataDir, 'mcp', 'servers.json'),
    JSON.stringify({
      version: 1,
      servers: [
        {
          ...baseMcpFields,
          serverId: 'abs-npx',
          connectionId: 'c1',
          transport: 'stdio',
          stdio: { command: '/opt/homebrew/bin/npx', args: ['demo'], env: {}, cwd: null },
          http: null,
        },
        {
          ...baseMcpFields,
          serverId: 'bare-uvx',
          connectionId: 'c2',
          transport: 'stdio',
          stdio: { command: 'uvx', args: ['mcp-server-git'], env: {}, cwd: null },
          http: null,
        },
      ],
    }),
  );

  const extBackend = new NativeIndexBackend(dataDir, log, (dir) =>
    openNativeIndex(
      dir,
      async () =>
        ({
          FileIndex: {
            open: async () => {
              throw new Error('invalid index options: external volume');
            },
          },
        }) as never,
    ),
  );
  await extBackend.search({ query: 'x', limit: 1, signal: new AbortController().signal });
  const indexDiag = extBackend.diagnosticsStatus();
  assert.equal(indexDiag.state, 'unsupported');
  assert.equal(indexDiag.loadErrorCode, 'options');

  try {
    const probedBins: string[] = [];
    const res = await runServiceDoctor(
      {
        config,
        systemProxy,
        addons: { list: () => [] } as never,
        automations: {
          store: {
            problem: undefined,
            data: { definitions: { automations: [] }, state: { automations: {}, notices: [] } },
          },
        } as never,
        log,
      },
      { includeConnectivity: true },
      {
        probeBinary: async (cmd) => {
          probedBins.push(cmd);
          return cmd === 'npx' || cmd === 'uvx'
            ? { ok: false, version: null, errorKind: 'missing' }
            : { ok: true, version: '1.0.0', errorKind: null };
        },
        resolveRg: async () => {
          throw new Error('missing rg');
        },
        probeFileIndex: async () => ({ ok: false, loadErrorCode: indexDiag.loadErrorCode }),
        headMirror: async () => {
          throw Object.assign(new Error('self signed'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
        },
      },
    );

    assert.ok(probedBins.includes('uvx'), 'Doctor must probe uvx directly when required');
    const cli = res.checks.find((c) => c.id === 'shell.host_cli_tools');
    assert.equal(cli?.status, 'fail');
    assert.equal(cli?.reasonCode, 'mcp_required_launcher_missing');
    assert.equal(cli?.metrics.requiredLauncherCount, 1);

    if (process.platform === 'darwin') {
      const fi = res.checks.find((c) => c.id === 'native.file_index_addon');
      assert.equal(fi?.status, 'warn');
      assert.equal(fi?.reasonCode, 'external_home_unsupported');
      assert.equal(fi?.remediation?.action, 'none');
    }

    for (const check of res.checks) {
      if (check.remediation?.docsUrl) assert.equal(check.remediation.docsUrl, 'https://atd.best');
    }
    assert.equal(
      res.checks.find((c) => c.id === 'shell.ripgrep_binary')?.remediation?.action,
      'none',
    );
    assert.equal(
      res.checks.find((c) => c.id === 'conn.mirror_tls_and_clock_skew')?.remediation?.action,
      'none',
    );
  } finally {
    await extBackend.close();
  }
});
