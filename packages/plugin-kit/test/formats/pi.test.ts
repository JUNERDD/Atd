import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { InvalidPluginError, normalizePlugin } from '../../src/formats/index.js';
import { globToRegExp } from '../../src/formats/glob.js';
import { NormalizedPluginSchema } from '../../src/model/manifest.js';
import { memoryFs } from '../helpers/memory-fs.js';

const skill = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\nBody\n`;

function load(pkg: Record<string, unknown>, files: Record<string, string> = {}) {
  return normalizePlugin(memoryFs({ 'package.json': JSON.stringify(pkg), ...files }), {
    fallbackName: 'fallback',
  });
}

const names = (plugin: Awaited<ReturnType<typeof load>>) =>
  plugin.components.map((component) => `${component.kind}:${component.name}`);

describe('pi adapter', () => {
  it('uses conventional directories without a pi key', async () => {
    const plugin = await load(
      {
        name: '@acme/pi-tools',
        version: '1.0.0',
        keywords: ['pi-package'],
        author: 'Ada <ada@example.com>',
        repository: { type: 'git', url: 'git+https://github.com/acme/pi-tools.git' },
      },
      {
        'skills/pdf/SKILL.md': skill('pdf'),
        'skills/group/deep/SKILL.md': skill('deep'),
        'skills/loose.md': '# standalone',
        'prompts/review.md': [
          '---',
          'description: Review staged changes',
          'argument-hint: "[focus]"',
          '---',
          'Review. Focus on ${1:-correctness}; extra: $@',
        ].join('\n'),
        'prompts/nested/plan.md':
          'Plan the work for the next release carefully and completely today.',
        'extensions/index.ts': 'export default {}',
        'themes/dark.json': '{}',
      },
    );
    expect(plugin.format).toBe('pi');
    expect(plugin.manifest).toEqual({
      name: 'acme-pi-tools',
      version: '1.0.0',
      keywords: ['pi-package'],
      author: { name: 'Ada', email: 'ada@example.com' },
      repository: 'git+https://github.com/acme/pi-tools.git',
    });
    expect(names(plugin)).toEqual(['skill:deep', 'skill:pdf', 'command:plan', 'command:review']);
    expect(plugin.components[2]).toMatchObject({
      description: 'Plan the work for the next release carefully and completely ...',
      source: 'prompts/nested/plan.md',
    });
    expect(plugin.components[3]).toEqual({
      kind: 'command',
      name: 'review',
      description: 'Review staged changes',
      argumentHint: '[focus]',
      arguments: [],
      segments: [
        { type: 'text', text: 'Review. Focus on ' },
        { type: 'argument', index: 1, fallback: 'correctness' },
        { type: 'text', text: '; extra: ' },
        { type: 'arguments' },
      ],
      allowedTools: [],
      source: 'prompts/review.md',
    });
    expect(plugin.diagnostics.map((d) => `${d.code}:${d.path}`)).toEqual([
      'renamed:package.json',
      'unsupported-component:extensions',
      'unsupported-component:skills/loose.md',
      'unsupported-component:themes',
    ]);
    expect(Value.Check(NormalizedPluginSchema, plugin)).toBe(true);
  });

  it('selects manifest resources with globs and exclusions, ignoring conventional dirs', async () => {
    const plugin = await load(
      {
        name: 'res',
        pi: {
          skills: ['./resources/skills', '!legacy'],
          prompts: [
            './resources/prompts/**/*.md',
            '!**/draft-*.md',
            '+resources/prompts/draft-keep.md',
          ],
        },
      },
      {
        'skills/ignored/SKILL.md': skill('ignored'),
        'resources/skills/new/SKILL.md': skill('new'),
        'resources/skills/legacy/SKILL.md': skill('legacy'),
        'resources/prompts/a.md': 'A',
        'resources/prompts/sub/b.md': 'B',
        'resources/prompts/draft-x.md': 'Draft',
        'resources/prompts/draft-keep.md': 'Keep',
        'resources/prompts/.hidden/c.md': 'Hidden',
      },
    );
    expect(names(plugin)).toEqual(['skill:new', 'command:a', 'command:b', 'command:draft-keep']);
    expect(plugin.diagnostics).toEqual([]);
  });

  it('applies exact -path exclusions and reports escapes and missing paths', async () => {
    const plugin = await load(
      {
        name: 'res',
        pi: {
          prompts: ['prompts', '-prompts/b.md', '../outside/*.md', './missing.md'],
          extensions: ['./ext.ts'],
          themes: 'not-an-array',
        },
      },
      { 'prompts/a.md': 'A', 'prompts/b.md': 'B', 'ext.ts': '' },
    );
    expect(names(plugin)).toEqual(['command:a']);
    expect(plugin.diagnostics.map((d) => `${d.code}:${d.path}`)).toEqual([
      'unsupported-component:package.json',
      'path-escape:../outside/*.md',
      'invalid-component:package.json',
      'invalid-component:package.json',
    ]);
  });

  it('reports duplicate prompt names and falls back to the directory name', async () => {
    const plugin = await load(
      { pi: { prompts: ['./p'] } },
      { 'p/one/x.md': 'One', 'p/two/x.md': 'Two' },
    );
    expect(plugin.manifest.name).toBe('fallback');
    expect(names(plugin)).toEqual(['command:x']);
    expect(plugin.diagnostics.map((d) => `${d.code}:${d.path}`)).toEqual(['duplicate:p/two/x.md']);
  });

  it('rejects an unparseable package.json', async () => {
    await expect(
      normalizePlugin(memoryFs({ 'package.json': '{"pi": ' }), { fallbackName: 'x' }),
    ).rejects.toBeInstanceOf(InvalidPluginError);
  });
});

describe('globToRegExp', () => {
  it.each([
    ['*.md', 'a.md', true],
    ['*.md', 'dir/a.md', false],
    ['*.md', '.a.md', false],
    ['**/*.md', 'a/b/c.md', true],
    ['**/*.md', 'c.md', true],
    ['a/**/c.md', 'a/c.md', true],
    ['a/**/c.md', 'a/.x/c.md', false],
    ['file?.ts', 'file1.ts', true],
    ['./skills/*', 'skills/pdf', true],
  ])('%s matches %s: %s', (pattern, path, expected) => {
    expect(globToRegExp(pattern).test(path)).toBe(expected);
  });
});
