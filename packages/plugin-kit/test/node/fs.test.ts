import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodeFs } from '../../src/node/fs.js';
import { PathEscapeError } from '../../src/ports.js';
import { tempDir } from './helpers.js';

async function setup() {
  const base = await tempDir();
  const root = path.join(base, 'plugin');
  const outside = path.join(base, 'outside');
  await mkdir(path.join(root, 'skills', 'a'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(root, 'skills', 'a', 'SKILL.md'), 'skill');
  await writeFile(path.join(outside, 'secret.txt'), 'secret');
  await symlink(path.join(outside, 'secret.txt'), path.join(root, 'leak.txt'));
  await symlink(outside, path.join(root, 'leak-dir'));
  await symlink('skills/a/SKILL.md', path.join(root, 'inner.md'));
  await symlink('skills', path.join(root, 'inner-dir'));
  await symlink('missing.txt', path.join(root, 'dangling'));
  return { root, fs: createNodeFs(root) };
}

describe('createNodeFs', () => {
  it('reads files and lists entries by their symlink target kind', async () => {
    const { fs } = await setup();
    expect(await fs.readText('skills/a/SKILL.md')).toBe('skill');
    expect(await fs.readText('inner.md')).toBe('skill');
    expect(await fs.list('')).toEqual([
      { name: 'inner-dir', kind: 'dir' },
      { name: 'inner.md', kind: 'file' },
      { name: 'leak-dir', kind: 'dir' },
      { name: 'leak.txt', kind: 'file' },
      { name: 'skills', kind: 'dir' },
    ]);
    expect(await fs.list('inner-dir')).toEqual([{ name: 'a', kind: 'dir' }]);
  });

  it('reports kinds and null for missing paths', async () => {
    const { fs } = await setup();
    expect(await fs.stat('')).toBe('dir');
    expect(await fs.stat('skills/a/SKILL.md')).toBe('file');
    expect(await fs.stat('nope.md')).toBeNull();
    expect(await fs.stat('dangling')).toBeNull();
    await expect(fs.readText('nope.md')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects paths that escape the root through symlinks or `..`', async () => {
    const { fs } = await setup();
    await expect(fs.readText('leak.txt')).rejects.toBeInstanceOf(PathEscapeError);
    await expect(fs.readText('leak-dir/secret.txt')).rejects.toBeInstanceOf(PathEscapeError);
    await expect(fs.list('leak-dir')).rejects.toBeInstanceOf(PathEscapeError);
    await expect(fs.stat('leak.txt')).rejects.toBeInstanceOf(PathEscapeError);
    await expect(fs.readText('../outside/secret.txt')).rejects.toBeInstanceOf(PathEscapeError);
    await expect(fs.stat('/etc/hosts')).rejects.toBeInstanceOf(PathEscapeError);
  });

  it('follows a root that is itself a symlink', async () => {
    const { root } = await setup();
    const alias = `${root}-alias`;
    await symlink(root, alias);
    const fs = createNodeFs(alias);
    expect(await fs.readText('skills/a/SKILL.md')).toBe('skill');
    await expect(fs.readText('leak.txt')).rejects.toBeInstanceOf(PathEscapeError);
  });
});
