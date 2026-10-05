import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchNpm } from '../../src/node/fetch-npm.js';
import { sourceFallbackName } from '../../src/node/fetch.js';
import { FetchLimitError } from '../../src/node/limits.js';
import { parseNpmSpec } from '../../src/node/npm-spec.js';
import { SKILL_MD, buildTarball, registryFetch, sri, tempDir } from './helpers.js';

const REGISTRY = 'https://registry.test';
const LIMITS = { maxBytes: 1024 * 1024, maxFiles: 100 };

function packument(name: string, tarball: Buffer, dist?: Record<string, string>) {
  const url = `${REGISTRY}/${name}/-/pkg-1.2.0.tgz`;
  return {
    url,
    document: {
      name,
      'dist-tags': { latest: '1.2.0', beta: '1.2.0' },
      versions: { '1.2.0': { dist: { tarball: url, ...(dist ?? { integrity: sri(tarball) }) } } },
    },
  };
}

async function stagingPaths() {
  const base = await tempDir();
  const workDir = path.join(base, 'work');
  await mkdir(workDir);
  return { tree: path.join(base, 'tree'), workDir };
}

describe('parseNpmSpec', () => {
  it('accepts names, exact versions and dist-tags', () => {
    expect(parseNpmSpec('pkg')).toEqual({
      name: 'pkg',
      selector: { type: 'tag', value: 'latest' },
    });
    expect(parseNpmSpec('pkg@1.2.3-rc.1')).toMatchObject({ selector: { type: 'version' } });
    expect(parseNpmSpec('@scope/pkg@next')).toEqual({
      name: '@scope/pkg',
      selector: { type: 'tag', value: 'next' },
    });
  });

  it.each([
    'pkg@^1.0.0',
    'pkg@~1.2',
    'pkg@1.x',
    'pkg@>=1',
    'pkg@1',
    'pkg@*',
    'pkg@x',
    'pkg@1 || 2',
  ])('rejects the range %s', (spec) => {
    expect(() => parseNpmSpec(spec)).toThrow(/range/);
  });

  it('rejects invalid names and non-registry specs', () => {
    expect(() => parseNpmSpec('Bad Name')).toThrow(/not a valid npm package name/);
    expect(() => parseNpmSpec('pkg@github:user/repo')).toThrow(/unsupported spec/);
  });
});

describe('fetchNpm', () => {
  it('resolves a dist-tag, verifies integrity and strips package/', async () => {
    const tarball = await buildTarball({ 'SKILL.md': SKILL_MD, 'scripts/run.sh': 'echo hi' });
    const { url, document } = packument('@acme/skill', tarball);
    const { fetch, requests } = registryFetch(REGISTRY, '@acme/skill', document, {
      [url]: tarball,
    });
    const paths = await stagingPaths();
    const fetched = await fetchNpm('@acme/skill@beta', paths, {
      registry: REGISTRY,
      fetch,
      limits: LIMITS,
    });

    expect(requests[0]).toBe(`${REGISTRY}/@acme%2fskill`);
    expect(fetched.source).toEqual({ kind: 'npm', spec: '@acme/skill@beta' });
    expect(fetched.resolved).toEqual({ version: '1.2.0', integrity: sri(tarball) });
    expect(sourceFallbackName(fetched.source)).toBe('@acme/skill');
    expect(fetched.warnings).toEqual([]);
    expect((await readdir(paths.tree)).sort()).toEqual(['SKILL.md', 'scripts']);
    expect(await readFile(path.join(paths.tree, 'SKILL.md'), 'utf8')).toBe(SKILL_MD);
    expect(await readdir(paths.workDir)).toEqual([]);
  });

  it('rejects a tarball that does not match its integrity', async () => {
    const tarball = await buildTarball({ 'SKILL.md': SKILL_MD });
    const other = await buildTarball({ 'SKILL.md': `${SKILL_MD}tampered` });
    const { url, document } = packument('pkg', tarball);
    const { fetch } = registryFetch(REGISTRY, 'pkg', document, { [url]: other });
    await expect(
      fetchNpm('pkg@1.2.0', await stagingPaths(), { registry: REGISTRY, fetch, limits: LIMITS }),
    ).rejects.toThrow(/sha512 integrity/);
  });

  it('verifies a SHA-1-only shasum and reports it as weak', async () => {
    const tarball = await buildTarball({ 'SKILL.md': SKILL_MD });
    const shasum = createHash('sha1').update(tarball).digest('hex');
    const { url, document } = packument('pkg', tarball, { shasum });
    const { fetch } = registryFetch(REGISTRY, 'pkg', document, { [url]: tarball });
    const fetched = await fetchNpm('pkg', await stagingPaths(), {
      registry: REGISTRY,
      fetch,
      limits: LIMITS,
    });
    expect(fetched.resolved.integrity).toBe(sri(tarball, 'sha1'));
    expect(fetched.warnings).toEqual([expect.stringMatching(/SHA-1/)]);
  });

  it('rejects ranges before contacting the registry', async () => {
    const { fetch, requests } = registryFetch(REGISTRY, 'pkg', {}, {});
    await expect(
      fetchNpm('pkg@^1.0.0', await stagingPaths(), { registry: REGISTRY, fetch, limits: LIMITS }),
    ).rejects.toThrow(/range/);
    expect(requests).toEqual([]);
  });

  it('reports unknown versions and tags', async () => {
    const tarball = await buildTarball({ 'SKILL.md': SKILL_MD });
    const { document } = packument('pkg', tarball);
    const { fetch } = registryFetch(REGISTRY, 'pkg', document, {});
    const options = { registry: REGISTRY, fetch, limits: LIMITS };
    await expect(fetchNpm('pkg@9.9.9', await stagingPaths(), options)).rejects.toThrow(
      /does not exist/,
    );
    await expect(fetchNpm('pkg@canary', await stagingPaths(), options)).rejects.toThrow(
      /no dist-tag/,
    );
  });

  it('enforces file-count and byte limits', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`f${i}.md`, 'x'.repeat(100)]),
    );
    const tarball = await buildTarball(files);
    const { url, document } = packument('pkg', tarball);
    const { fetch } = registryFetch(REGISTRY, 'pkg', document, { [url]: tarball });
    await expect(
      fetchNpm('pkg', await stagingPaths(), {
        registry: REGISTRY,
        fetch,
        limits: { maxBytes: 1e6, maxFiles: 3 },
      }),
    ).rejects.toBeInstanceOf(FetchLimitError);
    await expect(
      fetchNpm('pkg', await stagingPaths(), {
        registry: REGISTRY,
        fetch,
        limits: { maxBytes: 250, maxFiles: 100 },
      }),
    ).rejects.toBeInstanceOf(FetchLimitError);
  });

  it('drops links that point outside the package and keeps the rest', async () => {
    const tarball = await buildTarball({ 'SKILL.md': SKILL_MD }, async (dir) => {
      await symlink('../../etc/passwd', path.join(dir, 'escape'));
      await symlink('/etc/passwd', path.join(dir, 'absolute'));
      await symlink('SKILL.md', path.join(dir, 'inside'));
    });
    const { url, document } = packument('pkg', tarball);
    const { fetch } = registryFetch(REGISTRY, 'pkg', document, { [url]: tarball });
    const paths = await stagingPaths();
    const fetched = await fetchNpm('pkg', paths, { registry: REGISTRY, fetch, limits: LIMITS });
    expect(fetched.warnings).toEqual([
      expect.stringContaining('"absolute"'),
      expect.stringContaining('"escape"'),
    ]);
    expect((await readdir(paths.tree)).sort()).toEqual(['SKILL.md', 'inside']);
    expect(await readFile(path.join(paths.tree, 'inside'), 'utf8')).toBe(SKILL_MD);
  });
});
