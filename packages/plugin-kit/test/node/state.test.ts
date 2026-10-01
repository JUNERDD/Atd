import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UserConfigOption } from '../../src/model/manifest.js';
import type { InstalledPlugin } from '../../src/model/records.js';
import { PluginConfigError } from '../../src/node/config.js';
import { createPluginInstaller } from '../../src/node/installer.js';
import { PluginStoreError } from '../../src/node/store.js';
import { memorySecrets, tempDir } from './helpers.js';

const OPTIONS: UserConfigOption[] = [
  { key: 'token', type: 'string', required: true, sensitive: true },
  {
    key: 'port',
    type: 'number',
    required: false,
    sensitive: false,
    min: 1,
    max: 65535,
    default: 8080,
  },
  { key: 'mode', type: 'string', required: false, sensitive: false, options: ['fast', 'safe'] },
  { key: 'verbose', type: 'boolean', required: false, sensitive: false },
  { key: 'pin', type: 'number', required: false, sensitive: true },
];

const REV_A = 'a'.repeat(32);
const REV_B = 'b'.repeat(32);

function record(id: string, revision: string): InstalledPlugin {
  return {
    id,
    source: { kind: 'local', path: `/plugins/${id}` },
    resolved: {},
    revision,
    plugin: {
      format: 'skill',
      manifest: { name: id },
      components: [],
      userConfig: OPTIONS,
      diagnostics: [],
    },
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** An installer whose registry already holds `crafted` at REV_A, with REV_B left on disk. */
async function seeded() {
  const root = await tempDir();
  const secrets = memorySecrets();
  const installer = createPluginInstaller({ root, secrets });
  await writeFile(
    path.join(root, 'registry.json'),
    JSON.stringify({ version: 1, plugins: [record('crafted', REV_A)] }),
  );
  for (const revision of [REV_A, REV_B]) {
    await mkdir(path.join(root, 'revisions', 'crafted', revision), { recursive: true });
  }
  return { root, secrets, installer };
}

describe('plugin state', () => {
  it('stores toggles for any plugin id, including host plugins', async () => {
    const { installer } = await seeded();
    await installer.setPluginEnabled('shared:agents-skills', false);
    await installer.setItemEnabled('shared:agents-skills', 'skill:review', false);
    await installer.setPluginEnabled('crafted', false);
    await installer.setPluginEnabled('crafted', true);
    expect(await installer.readState()).toEqual({
      version: 1,
      disabled: ['shared:agents-skills'],
      items: { 'shared:agents-skills': ['skill:review'] },
      config: {},
    });
    await installer.setItemEnabled('shared:agents-skills', 'skill:review', true);
    expect(await installer.readState()).toMatchObject({ items: {} });
  });

  it('validates config, keeps secrets out of state and fills defaults', async () => {
    const { installer, secrets } = await seeded();
    await installer.setConfig('crafted', OPTIONS, { token: 's3cret', mode: 'safe', pin: 42 });
    expect((await installer.readState()).config).toEqual({ crafted: { mode: 'safe' } });
    expect([...secrets.values.values()].sort()).toEqual(['42', 's3cret']);
    expect(await installer.readConfig('crafted', OPTIONS)).toEqual({
      token: 's3cret',
      port: 8080,
      mode: 'safe',
      pin: 42,
    });

    const invalid: Record<string, unknown>[] = [
      { unknown: 'x' },
      { port: 0 },
      { port: 70000 },
      { port: '80' },
      { mode: 'slow' },
      { verbose: 'yes' },
      { token: 5 },
    ];
    for (const values of invalid) {
      await expect(
        installer.setConfig('crafted', OPTIONS, values as Record<string, string>),
      ).rejects.toBeInstanceOf(PluginConfigError);
    }
    // A rejected batch writes nothing, even for its valid keys.
    await expect(
      installer.setConfig('crafted', OPTIONS, { mode: 'fast', port: -1 }),
    ).rejects.toThrow();
    expect((await installer.readState()).config).toEqual({ crafted: { mode: 'safe' } });

    await installer.setConfig('crafted', OPTIONS, { token: null, mode: null, verbose: false });
    expect(secrets.values.size).toBe(1);
    expect(await installer.readConfig('crafted', OPTIONS)).toEqual({
      port: 8080,
      verbose: false,
      pin: 42,
    });
  });

  it('uninstalls: record, state, secrets and data go; unreferenced revisions are collected', async () => {
    const { root, installer, secrets } = await seeded();
    await installer.setConfig('crafted', OPTIONS, { token: 't', mode: 'fast' });
    await installer.setItemEnabled('crafted', 'skill:x', false);
    await installer.setPluginEnabled('crafted', false);
    await writeFile(path.join(await installer.dataDir('crafted'), 'cache.json'), '{}');

    await installer.uninstall('crafted');
    expect(await installer.list()).toEqual([]);
    expect(await installer.readState()).toEqual({
      version: 1,
      disabled: [],
      items: {},
      config: {},
    });
    expect(secrets.values.size).toBe(0);
    expect(await readdir(path.join(root, 'data'))).toEqual([]);
    expect(await readdir(path.join(root, 'revisions'))).toEqual([]);
    await expect(installer.uninstall('crafted')).rejects.toThrow(/not installed/);
  });

  it('keeps revisions a run retains until it is released', async () => {
    const { root, installer } = await seeded();
    const revisions = () =>
      readdir(path.join(root, 'revisions', 'crafted')).then((names) => names.sort());
    await installer.retain('run-1', {
      plugins: [{ id: 'crafted', revision: REV_B }],
      items: { skill: [], agent: [], command: [], mcp: [], memory: [] },
    });
    await installer.release('run-other');
    expect(await revisions()).toEqual([REV_A, REV_B]);

    await installer.uninstall('crafted');
    expect(await revisions()).toEqual([REV_B]);
    await installer.release('run-1');
    expect(await readdir(path.join(root, 'revisions'))).toEqual([]);
    expect(JSON.parse(await readFile(path.join(root, 'refs.json'), 'utf8'))).toEqual({
      version: 1,
      runs: {},
    });
  });

  it('validates ids and revisions used as paths', async () => {
    const { installer } = await seeded();
    expect(() => installer.revisionDir('../x', REV_A)).toThrow(/not an installable plugin id/);
    expect(() => installer.revisionDir('crafted', '../x')).toThrow(/not a revision/);
    await expect(installer.dataDir('shared:agents-skills')).rejects.toThrow();
    expect(await installer.revisionFs('crafted', REV_A).list('')).toEqual([]);
  });

  it('preserves a malformed registry and reports it', async () => {
    const { root, installer } = await seeded();
    const file = path.join(root, 'registry.json');
    await writeFile(file, '{"version":1,"plugins":[{"id":');
    await expect(installer.list()).rejects.toBeInstanceOf(PluginStoreError);
    await expect(installer.uninstall('crafted')).rejects.toBeInstanceOf(PluginStoreError);
    await expect(installer.release('run')).rejects.toBeInstanceOf(PluginStoreError);
    await writeFile(path.join(root, 'state.json'), '{"version":2}');
    await expect(installer.setPluginEnabled('x', false)).rejects.toThrow(
      /state\.json is malformed/,
    );
    expect(await readFile(file, 'utf8')).toBe('{"version":1,"plugins":[{"id":');
    expect(await readFile(path.join(root, 'state.json'), 'utf8')).toBe('{"version":2}');
  });
});
