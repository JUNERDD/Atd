import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedPlugin } from '../../src/model/manifest.js';
import { createNodeFs } from '../../src/node/fs.js';
import { hashTree } from '../../src/node/hash.js';
import { buildReview } from '../../src/node/review.js';
import { SKILL_FIXTURE, tempDir } from './helpers.js';

const plugin: NormalizedPlugin = {
  format: 'claude',
  manifest: { name: 'tools' },
  userConfig: [],
  diagnostics: [],
  components: [
    {
      kind: 'skill',
      name: 'hello',
      description: 'Greets.',
      dir: 'skills/hello',
      entry: 'skills/hello/SKILL.md',
      frontmatter: {},
    },
    {
      kind: 'mcp',
      name: 'db',
      source: '.mcp.json',
      transport: { type: 'stdio', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/db.js'], env: {} },
    },
    {
      kind: 'mcp',
      name: 'docs',
      source: '.mcp.json',
      transport: { type: 'http', protocol: 'sse', url: 'https://docs.example/sse', headers: {} },
    },
  ],
};

describe('buildReview', () => {
  it('lists stdio commands, remote endpoints and scripts inside skills', async () => {
    const root = await tempDir();
    await cp(SKILL_FIXTURE, path.join(root, 'skills', 'hello'), { recursive: true });
    await mkdir(path.join(root, 'skills', 'hello', 'lib'));
    await writeFile(path.join(root, 'skills', 'hello', 'lib', 'Tool.PY'), 'print(1)');
    await writeFile(path.join(root, 'db.js'), 'outside any skill');

    expect(await buildReview(plugin, createNodeFs(root))).toEqual({
      stdio: [{ name: 'db', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/db.js'] }],
      urls: [{ name: 'docs', url: 'https://docs.example/sse' }],
      scripts: ['skills/hello/lib/Tool.PY', 'skills/hello/scripts/greet.sh'],
    });
  });
});

describe('hashTree', () => {
  it('depends on paths and bytes only', async () => {
    const first = await tempDir();
    const second = await tempDir();
    await cp(SKILL_FIXTURE, first, { recursive: true });
    await cp(SKILL_FIXTURE, second, { recursive: true });
    await mkdir(path.join(second, 'empty'));
    const hash = await hashTree(first);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(await hashTree(second)).toBe(hash);
    await writeFile(path.join(second, 'notes.txt'), 'changed');
    expect(await hashTree(second)).not.toBe(hash);
  });
});
