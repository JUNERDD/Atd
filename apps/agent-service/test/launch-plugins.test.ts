import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  McpLaunchApproveResponseSchema,
  parse,
  PluginDetailSchema,
  PluginDuplicateResponseSchema,
  PluginInstallPreviewSchema,
} from '@atd/agent-contracts';
import { launchStoreFile } from '../dist/mcp/launch-store.js';
import { serversFile } from '../dist/mcp/servers.js';
import { client, errorCode, exists, launcher } from './launch-helpers.ts';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * Launch approvals for plugin servers (which plugin state no longer approves) and the one-time
 * migration: profiles from before launch approvals keep no approval and get a notice.
 */

installMemoryKeyring();
const temporary: string[] = [];
let harness: Awaited<ReturnType<typeof startTestService>>;
let api: ReturnType<typeof client>;

before(async () => {
  harness = await startTestService();
  api = client(harness);
});
after(async () => {
  await harness.stop();
  for (const dir of temporary) await rm(dir, { recursive: true, force: true });
});

/** A local Claude-format plugin whose stdio server takes its mode from user config. */
async function pluginFolder(command: string, name: string): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'launch-plugin-'));
  temporary.push(folder);
  await mkdir(path.join(folder, '.claude-plugin'));
  await writeFile(
    path.join(folder, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      description: 'Fixture',
      userConfig: { MODE: { type: 'string', title: 'Mode', default: 'a' } },
    }),
  );
  await writeFile(
    path.join(folder, '.mcp.json'),
    JSON.stringify({
      mcpServers: { db: { command, args: ['--mode', '${user_config.MODE}'] } },
    }),
  );
  return folder;
}

async function install(folder: string, update?: string): Promise<string> {
  const preview = update
    ? await api.send(`/v1/plugins/${encodeURIComponent(update)}/update/preview`, 'POST')
    : await api.send('/v1/plugins/preview', 'POST', { source: { kind: 'local', path: folder } });
  assert.equal(preview.status, 200, preview.text);
  const { previewId } = parse(PluginInstallPreviewSchema, preview.json);
  const installed = await api.send('/v1/plugins/install', 'POST', { previewId });
  assert.equal(installed.status, 200, installed.text);
  return parse(PluginDetailSchema, installed.json).plugin.id;
}

test('plugin servers need their own approval; an update or a config change voids it', async () => {
  const { command, marker } = await launcher(temporary);
  const folder = await pluginFolder(command, 'launch-kit');
  const source = `local ${await realpath(folder)}`;
  const id = await install(folder);
  const enabled = await api.send(`/v1/plugins/${encodeURIComponent(id)}/enabled`, 'POST', {
    enabled: true,
  });
  assert.equal(enabled.status, 200, enabled.text);
  const item = parse(PluginDetailSchema, enabled.json).items.find((entry) => entry.kind === 'mcp');
  assert.equal(item?.enabled, true, 'plugin state no longer blocks a local server');
  assert.equal(item?.blockedBy, undefined);
  const serverId = item?.name ?? '';
  const row = (await api.status()).servers.find((server) => server.serverId === serverId);
  assert.deepEqual(
    { approval: row?.approval, readOnly: row?.readOnly, pluginId: row?.pluginId },
    { approval: 'required', readOnly: true, pluginId: id },
  );

  const refused = await api.send('/v1/mcp/connect', 'POST', { serverId });
  assert.equal(refused.status, 403, refused.text);
  assert.equal(errorCode(refused.json), 'approval_required');
  assert.equal(await exists(marker), false, 'nothing was spawned');

  const { details } = await api.details(serverId);
  assert.equal(details.layer, 'plugin');
  assert.equal(details.name, 'db');
  assert.deepEqual(details.stdio?.args, ['--mode', 'a']);
  assert.equal(details.plugin?.id, id);
  assert.equal(details.plugin?.version, '1.0.0');
  assert.equal(details.plugin?.source, source);
  const approved = await api.approve(serverId, details.fingerprint);
  assert.equal(approved.status, 200, approved.text);
  const { approval } = parse(McpLaunchApproveResponseSchema, approved.json);
  assert.deepEqual(approval.plugin, {
    id,
    revision: details.plugin?.revision,
    resolved: source,
  });
  assert.equal(await api.approvalOf(serverId), 'approved');

  const configured = await api.send(`/v1/plugins/${encodeURIComponent(id)}/config`, 'PUT', {
    values: { MODE: 'b' },
  });
  assert.equal(configured.status, 200, configured.text);
  assert.equal(await api.approvalOf(serverId), 'changed', 'a config value reached the args');
  await api.approveNow(serverId);

  await writeFile(path.join(folder, 'NOTES.md'), 'a new revision');
  await install(folder, id);
  assert.equal(await api.approvalOf(serverId), 'changed', 'an update is a new revision');

  const withdrawn = await api.send(
    `/v1/mcp/servers/${encodeURIComponent(serverId)}/approval`,
    'DELETE',
  );
  assert.equal(withdrawn.status, 200, withdrawn.text);
  assert.equal(await api.approvalOf(serverId), 'required');
});

test('a Personal copy of a plugin server needs its own approval', async () => {
  const { command } = await launcher(temporary);
  const id = await install(await pluginFolder(command, 'copy-kit'));
  const serverId = `${id}:db`;
  await api.approveNow(serverId);
  const copy = await api.send(
    `/v1/plugins/${encodeURIComponent(id)}/items/mcp/db/duplicate`,
    'POST',
  );
  assert.equal(copy.status, 200, copy.text);
  const { name } = parse(PluginDuplicateResponseSchema, copy.json);
  assert.equal(await api.approvalOf(name), 'required');
});

/** A service whose data dir is seeded as a profile from before launch approvals. */
async function seededService(seed: (dataDir: string) => Promise<void>) {
  const seeded = await startTestService();
  await seed(seeded.config.paths.root);
  return { seeded, seededApi: client(seeded) };
}

const legacyServer = (command: string) => ({
  serverId: 'legacy',
  revision: 1,
  connectionId: 'legacy-connection',
  transport: 'stdio',
  stdio: { command, args: [], env: {}, cwd: null },
  http: null,
  principal: '',
  isolateByTask: false,
  exposeResources: false,
  exposure: 'auto' as const,
  approveTools: true,
  includeTools: [],
  excludeTools: [],
  requestTimeoutMs: null,
  disabled: false,
});

test('existing servers need approving once, with a notice the renderer can dismiss', async () => {
  const { command, marker } = await launcher(temporary);
  const { seeded, seededApi } = await seededService(async (dataDir) => {
    await mkdir(path.dirname(serversFile(dataDir)), { recursive: true });
    await writeFile(
      serversFile(dataDir),
      JSON.stringify({ version: 1, servers: [legacyServer(command)] }),
    );
  });
  try {
    const status = await seededApi.status();
    assert.equal(status.approvalNotice, true);
    assert.equal(status.servers.find((row) => row.serverId === 'legacy')?.approval, 'required');
    const refused = await seededApi.send('/v1/mcp/connect', 'POST', { serverId: 'legacy' });
    assert.equal(refused.status, 403, 'nothing is grandfathered');
    assert.equal(await exists(marker), false);
    const dismissed = await seededApi.send('/v1/mcp/approvals/notice/dismiss', 'POST', {});
    assert.equal(dismissed.status, 200, dismissed.text);
    assert.equal((await seededApi.status()).approvalNotice, false);
    assert.equal((await seededApi.stored()).notice, false, 'the dismissal is kept');
  } finally {
    await seeded.stop();
  }
});

test('plugin approvals from before launch approvals also raise the notice, and approve nothing', async () => {
  const { seeded, seededApi } = await seededService(async (dataDir) => {
    await mkdir(path.join(dataDir, 'plugins'), { recursive: true });
    await writeFile(
      path.join(dataDir, 'plugins', 'state.json'),
      JSON.stringify({
        version: 1,
        disabled: [],
        items: {},
        config: {},
        approved: { gone: ['db'] },
      }),
    );
  });
  try {
    assert.equal((await seededApi.status()).approvalNotice, true);
    assert.deepEqual((await seededApi.stored()).approvals, []);
  } finally {
    await seeded.stop();
  }
});

test('a profile with nothing to approve gets no notice, and later servers raise none', async () => {
  assert.equal(await exists(launchStoreFile(harness.config.paths.root)), true);
  const { seeded, seededApi } = await seededService(async () => undefined);
  try {
    assert.equal((await seededApi.status()).approvalNotice, false);
    const { command } = await launcher(temporary);
    await seededApi.send('/v1/mcp/servers/later', 'PUT', {
      transport: 'stdio',
      command,
      args: [],
      auth: { type: 'none' },
    });
    const status = await seededApi.status();
    assert.equal(status.approvalNotice, false);
    assert.equal(status.servers.find((row) => row.serverId === 'later')?.approval, 'required');
  } finally {
    await seeded.stop();
  }
});
