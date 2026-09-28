import { cp, mkdir, readdir, readlink, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchGit, normalizeSubdir, type GitClone } from '../../src/node/fetch-git.js';
import { fetchLocal } from '../../src/node/fetch-local.js';
import { FetchLimitError } from '../../src/node/limits.js';
import { SKILL_FIXTURE, tempDir } from './helpers.js';

const COMMIT = 'a'.repeat(40);
const LIMITS = { maxBytes: 1024 * 1024, maxFiles: 100 };

/** A clone seam that lays out a repository with the skill fixture under `plugins/hello`. */
function fakeClone(calls: Parameters<GitClone>[0][] = []): GitClone {
  return async (input) => {
    calls.push(input);
    await cp(SKILL_FIXTURE, path.join(input.dir, 'plugins', 'hello'), { recursive: true });
    await mkdir(path.join(input.dir, '.git'), { recursive: true });
    await writeFile(path.join(input.dir, '.git', 'HEAD'), 'ref: refs/heads/main');
    await writeFile(path.join(input.dir, 'README.md'), 'repo');
    return { commit: COMMIT };
  };
}

async function stagingPaths() {
  const base = await tempDir();
  const workDir = path.join(base, 'work');
  await mkdir(workDir);
  return { tree: path.join(base, 'tree'), workDir };
}

describe('fetchGit', () => {
  it('publishes the repository without .git and pins the commit', async () => {
    const calls: Parameters<GitClone>[0][] = [];
    const paths = await stagingPaths();
    const fetched = await fetchGit(
      { url: 'https://example.test/acme/tools.git', ref: 'v1' },
      paths,
      LIMITS,
      fakeClone(calls),
    );
    expect(calls).toEqual([
      {
        url: 'https://example.test/acme/tools.git',
        ref: 'v1',
        dir: path.join(paths.workDir, 'clone'),
      },
    ]);
    expect(fetched).toEqual({
      source: { kind: 'git', url: 'https://example.test/acme/tools.git', ref: 'v1' },
      resolved: { commit: COMMIT },
      fallbackName: 'tools',
      warnings: [],
    });
    expect((await readdir(paths.tree)).sort()).toEqual(['README.md', 'plugins']);
    expect(await readdir(paths.workDir)).toEqual([]);
  });

  it('selects a normalized subdirectory as the plugin root', async () => {
    const paths = await stagingPaths();
    const fetched = await fetchGit(
      { url: 'https://example.test/acme/tools', subdir: '/plugins/hello/' },
      paths,
      LIMITS,
      fakeClone(),
    );
    expect(fetched.source).toEqual({
      kind: 'git',
      url: 'https://example.test/acme/tools',
      subdir: 'plugins/hello',
    });
    expect(fetched.fallbackName).toBe('hello');
    expect((await readdir(paths.tree)).sort()).toEqual(['SKILL.md', 'notes.txt', 'scripts']);
  });

  it('rejects non-https URLs and subdirectories outside the repository', async () => {
    const clone = fakeClone();
    await expect(
      fetchGit({ url: 'git@example.test:acme/tools.git' }, await stagingPaths(), LIMITS, clone),
    ).rejects.toThrow(/not a valid git URL/);
    await expect(
      fetchGit({ url: 'http://example.test/acme/tools' }, await stagingPaths(), LIMITS, clone),
    ).rejects.toThrow(/Only https/);
    await expect(
      fetchGit(
        { url: 'https://example.test/a', subdir: '../x' },
        await stagingPaths(),
        LIMITS,
        clone,
      ),
    ).rejects.toThrow(/leaves the repository/);
    await expect(
      fetchGit(
        { url: 'https://example.test/a', subdir: 'missing' },
        await stagingPaths(),
        LIMITS,
        clone,
      ),
    ).rejects.toThrow(/no folder/);
  });

  it('rejects a subdirectory that is a symlink out of the clone', async () => {
    const outside = await tempDir();
    const clone: GitClone = async ({ dir }) => {
      await mkdir(dir, { recursive: true });
      await symlink(outside, path.join(dir, 'link'));
      return { commit: COMMIT };
    };
    await expect(
      fetchGit(
        { url: 'https://example.test/a', subdir: 'link' },
        await stagingPaths(),
        LIMITS,
        clone,
      ),
    ).rejects.toThrow(/outside the repository/);
  });

  it('normalizes subdirectories', () => {
    expect(normalizeSubdir(undefined)).toBe('');
    expect(normalizeSubdir('./')).toBe('');
    expect(normalizeSubdir('a/./b/../c')).toBe('a/c');
    expect(() => normalizeSubdir('a/../../b')).toThrow();
  });
});

describe('fetchLocal', () => {
  it('copies a folder without .git and node_modules, dropping links that leave it', async () => {
    const source = await tempDir();
    await cp(SKILL_FIXTURE, source, { recursive: true });
    await mkdir(path.join(source, '.git'));
    await mkdir(path.join(source, 'node_modules', 'dep'), { recursive: true });
    await symlink('/etc/hosts', path.join(source, 'hosts'));
    await symlink('../../outside.txt', path.join(source, 'scripts', 'up'));
    await symlink('../notes.txt', path.join(source, 'scripts', 'notes'));
    await symlink(path.join(source, 'SKILL.md'), path.join(source, 'absolute-inside'));
    const { tree } = await stagingPaths();
    const fetched = await fetchLocal(source, tree, LIMITS);
    expect(fetched.resolved).toEqual({});
    expect(fetched.source.kind).toBe('local');
    expect(fetched.warnings).toEqual([
      expect.stringContaining('"absolute-inside"'),
      expect.stringContaining('"hosts"'),
      expect.stringContaining('"scripts/up"'),
    ]);
    expect((await readdir(tree)).sort()).toEqual(['SKILL.md', 'notes.txt', 'scripts']);
    expect((await readdir(path.join(tree, 'scripts'))).sort()).toEqual(['greet.sh', 'notes']);
    expect(await readlink(path.join(tree, 'scripts', 'notes'))).toBe('../notes.txt');
  });

  it('rejects missing sources, files and oversized folders', async () => {
    const base = await tempDir();
    await expect(
      fetchLocal(path.join(base, 'missing'), path.join(base, 't1'), LIMITS),
    ).rejects.toThrow(/does not exist/);
    await writeFile(path.join(base, 'file.txt'), 'x');
    await expect(
      fetchLocal(path.join(base, 'file.txt'), path.join(base, 't2'), LIMITS),
    ).rejects.toThrow(/not a folder/);
    await expect(
      fetchLocal(SKILL_FIXTURE, path.join(base, 't3'), { maxBytes: 1e6, maxFiles: 2 }),
    ).rejects.toBeInstanceOf(FetchLimitError);
  });
});
