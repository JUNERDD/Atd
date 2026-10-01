import { cp, mkdir, readdir, readlink, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidPluginError } from '../../src/formats/index.js';
import type { Logger } from '../../src/ports.js';
import {
  createPluginInstaller,
  PluginConflictError,
  type GitClone,
} from '../../src/node/installer.js';
import {
  SKILL_FIXTURE,
  SKILL_MD,
  buildTarball,
  copySkillFixture,
  memorySecrets,
  registryFetch,
  sri,
  tempDir,
} from './helpers.js';

const EMPTY_ITEMS = { skill: [], agent: [], command: [], mcp: [], memory: [] };

async function setup(
  options: { gitClone?: GitClone; fetch?: typeof globalThis.fetch; logger?: Logger } = {},
) {
  const base = await tempDir();
  const root = path.join(base, 'plugins');
  let now = Date.parse('2026-09-28T10:00:00.000Z');
  const clock = { now: () => new Date(now) };
  const installer = createPluginInstaller({
    root,
    secrets: memorySecrets(),
    clock,
    previewTtlMs: 60_000,
    npmRegistry: 'https://registry.test',
    ...options,
  });
  const advance = (ms: number) => {
    now += ms;
  };
  const revisions = async (id: string) => (await readdir(path.join(root, 'revisions', id))).sort();
  return { base, root, installer, advance, revisions };
}

describe('PluginInstaller (local)', () => {
  it('previews, publishes an immutable revision and lands disabled', async () => {
    const { base, root, installer } = await setup();
    const source = await copySkillFixture(base);
    const preview = await installer.preview({ kind: 'local', path: source });
    const id = preview.plugin.manifest.name;
    expect(preview.revision).toMatch(/^[0-9a-f]{32}$/);
    expect(preview.expiresAt).toBe('2026-09-28T10:01:00.000Z');
    expect(preview.existing).toBeUndefined();
    expect(preview.review.scripts).toEqual(['scripts/greet.sh']);
    expect(preview.plugin.components).toContainEqual(expect.objectContaining({ kind: 'skill' }));

    const installed = await installer.install(preview.previewId);
    expect(installed).toMatchObject({ id, revision: preview.revision, resolved: {} });
    expect(installed.installedAt).toBe('2026-09-28T10:00:00.000Z');
    expect((await installer.readState()).disabled).toEqual([id]);
    expect(await installer.list()).toEqual([installed]);
    expect(await readdir(path.join(root, 'staging'))).toEqual([]);
    const fs = installer.revisionFs(id, preview.revision);
    expect(await fs.readText('SKILL.md')).toContain('hello-skill');
    await expect(installer.install(preview.previewId)).rejects.toThrow(
      /does not exist or has expired/,
    );
  });

  it('updates in place, keeping state, and collects the old revision after release', async () => {
    const { base, installer, advance, revisions } = await setup();
    const source = await copySkillFixture(base);
    const first = await installer.install(
      (await installer.preview({ kind: 'local', path: source })).previewId,
    );
    const id = first.id;
    await installer.setPluginEnabled(id, true);
    await installer.setItemEnabled(id, 'skill:hello-skill', false);
    await installer.retain('run-1', {
      plugins: [{ id, revision: first.revision }],
      items: EMPTY_ITEMS,
    });
    const stateBefore = await installer.readState();

    await writeFile(path.join(source, 'notes.txt'), 'new notes');
    advance(1000);
    const update = await installer.previewUpdate(id);
    expect(update.existing).toEqual({ revision: first.revision, source: first.source });
    expect(update.revision).not.toBe(first.revision);
    const second = await installer.install(update.previewId);

    expect(second.installedAt).toBe(first.installedAt);
    expect(second.updatedAt).toBe('2026-09-28T10:00:01.000Z');
    expect(await installer.readState()).toEqual(stateBefore);
    expect(await revisions(id)).toEqual([first.revision, second.revision].sort());
    await installer.release('run-1');
    expect(await revisions(id)).toEqual([second.revision]);
  });

  it('rejects the same id from a different source', async () => {
    const { base, installer } = await setup();
    const one = await copySkillFixture(path.join(base, 'one'));
    const two = await copySkillFixture(path.join(base, 'two'));
    await installer.install((await installer.preview({ kind: 'local', path: one })).previewId);
    const preview = await installer.preview({ kind: 'local', path: two });
    expect(preview.existing).toBeDefined();
    await expect(installer.install(preview.previewId)).rejects.toBeInstanceOf(PluginConflictError);
  });

  it('reuses an identical revision and expires unconfirmed previews', async () => {
    const { base, root, installer, advance, revisions } = await setup();
    const source = await copySkillFixture(base);
    const first = await installer.preview({ kind: 'local', path: source });
    const again = await installer.preview({ kind: 'local', path: source });
    expect(again.revision).toBe(first.revision);
    const installed = await installer.install(first.previewId);
    await installer.install(again.previewId);
    expect(await revisions(installed.id)).toEqual([installed.revision]);

    const stale = await installer.preview({ kind: 'local', path: source });
    advance(60_001);
    await expect(installer.install(stale.previewId)).rejects.toThrow(/expired/);
    expect(await readdir(path.join(root, 'staging'))).toEqual([]);
  });

  it('publishes in-root symlinks and drops escaping ones with a warning', async () => {
    const warnings: string[] = [];
    const logger: Logger = { info: () => {}, warn: (message) => warnings.push(message) };
    const { base, installer } = await setup({ logger });
    const source = await copySkillFixture(base);
    await writeFile(path.join(base, 'outside.txt'), 'outside');
    await symlink(path.join(base, 'outside.txt'), path.join(source, 'absolute'));
    await symlink('../outside.txt', path.join(source, 'parent'));
    await symlink('scripts/greet.sh', path.join(source, 'greet'));
    const installed = await installer.install(
      (await installer.preview({ kind: 'local', path: source })).previewId,
    );
    const revision = installer.revisionDir(installed.id, installed.revision);
    const names = await readdir(revision);
    expect(names).toContain('greet');
    expect(names).not.toContain('absolute');
    expect(names).not.toContain('parent');
    expect(await readlink(path.join(revision, 'greet'))).toBe('scripts/greet.sh');
    expect(warnings).toEqual([
      expect.stringContaining('"absolute"'),
      expect.stringContaining('"parent"'),
    ]);
  });

  it('rejects an unusable bundle and discards its staging', async () => {
    const { base, root, installer } = await setup();
    const empty = path.join(base, 'empty');
    await mkdir(empty);
    await writeFile(path.join(empty, 'README.md'), 'nothing to load');
    await expect(installer.preview({ kind: 'local', path: empty })).rejects.toBeInstanceOf(
      InvalidPluginError,
    );
    expect(await readdir(path.join(root, 'staging'))).toEqual([]);
  });
});

describe('PluginInstaller (npm and git)', () => {
  it('installs an npm package pinned to its version and integrity', async () => {
    const tarball = await buildTarball({ 'SKILL.md': SKILL_MD });
    const url = 'https://registry.test/npm-skill/-/npm-skill-2.0.0.tgz';
    const { fetch } = registryFetch(
      'https://registry.test',
      'npm-skill',
      {
        'dist-tags': { latest: '2.0.0' },
        versions: { '2.0.0': { dist: { tarball: url, integrity: sri(tarball) } } },
      },
      { [url]: tarball },
    );
    const { installer } = await setup({ fetch });
    const preview = await installer.preview({ kind: 'npm', spec: 'npm-skill' });
    expect(preview.resolved).toEqual({ version: '2.0.0', integrity: sri(tarball) });
    const installed = await installer.install(preview.previewId);
    expect(installed.source).toEqual({ kind: 'npm', spec: 'npm-skill' });
    const update = await installer.preview({ kind: 'npm', spec: 'npm-skill@2.0.0' });
    await expect(installer.install(update.previewId)).resolves.toMatchObject({ id: installed.id });
  });

  it('pins git installs to the cloned commit and keys identity on url and subdir', async () => {
    let commit = '1'.repeat(40);
    const gitClone: GitClone = async ({ dir }) => {
      await cp(SKILL_FIXTURE, path.join(dir, 'plugins', 'hello'), { recursive: true });
      await mkdir(path.join(dir, '.git'));
      return { commit };
    };
    const { installer } = await setup({ gitClone });
    const url = 'https://example.test/acme/tools.git';
    const first = await installer.install(
      (await installer.preview({ kind: 'git', url, subdir: 'plugins/hello' })).previewId,
    );
    expect(first.resolved).toEqual({ commit });
    expect(await installer.revisionFs(first.id, first.revision).stat('.git')).toBeNull();

    commit = '2'.repeat(40);
    const moved = await installer.preview({
      kind: 'git',
      url,
      ref: 'main',
      subdir: 'plugins/hello/',
    });
    await expect(installer.install(moved.previewId)).resolves.toMatchObject({
      resolved: { commit },
    });

    const fork = await installer.preview({
      kind: 'git',
      url: 'https://example.test/fork/tools',
      subdir: 'plugins/hello',
    });
    await expect(installer.install(fork.previewId)).rejects.toBeInstanceOf(PluginConflictError);
  });
});
