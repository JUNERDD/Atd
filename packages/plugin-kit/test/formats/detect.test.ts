import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { detectFormat, InvalidPluginError, normalizePlugin } from '../../src/formats/index.js';
import { NormalizedPluginSchema } from '../../src/model/manifest.js';
import { memoryFs } from '../helpers/memory-fs.js';

const AP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const SKILL = '---\nname: lint\ndescription: Lints code\n---\nRun the linter.\n';

describe('detectFormat', () => {
  it.each([
    ['agent-plugins', { 'plugin.json': JSON.stringify({ $schema: AP_SCHEMA, name: 'x' }) }],
    ['claude', { '.claude-plugin/plugin.json': '{"name":"x"}' }],
    ['claude', { 'commands/a.md': 'Hi' }],
    ['claude', { '.mcp.json': '{}' }],
    ['claude', { 'skills/lint/SKILL.md': SKILL }],
    ['pi', { 'package.json': '{"name":"x","pi":{}}' }],
    [
      'pi',
      { 'package.json': '{"name":"x","keywords":["pi-package"]}', 'skills/a/SKILL.md': SKILL },
    ],
    ['skill', { 'SKILL.md': SKILL }],
  ] as const)('detects %s', async (format, files) => {
    expect(await detectFormat(memoryFs(files))).toBe(format);
  });

  it('prefers Agent Plugins over Claude markers and Claude over pi', async () => {
    const both = memoryFs({
      'plugin.json': JSON.stringify({ $schema: AP_SCHEMA, name: 'x' }),
      'commands/a.md': 'Hi',
    });
    expect(await detectFormat(both)).toBe('agent-plugins');
    const claudeAndPi = memoryFs({
      '.claude-plugin/plugin.json': '{"name":"x"}',
      'package.json': '{"name":"x","pi":{}}',
    });
    expect(await detectFormat(claudeAndPi)).toBe('claude');
  });

  it('does not treat a root plugin.json without the Agent Plugins schema as a Claude marker', async () => {
    expect(
      await detectFormat(memoryFs({ 'plugin.json': '{"name":"x"}', 'commands/a.md': 'Hi' })),
    ).toBeNull();
  });

  it('returns null for an unrecognized or unreadable root', async () => {
    expect(await detectFormat(memoryFs({ 'README.md': '# hi' }))).toBeNull();
    expect(
      await detectFormat(
        memoryFs({}, { escapes: { '.claude-plugin': 'dir', 'SKILL.md': 'file' } }),
      ),
    ).toBeNull();
  });
});

describe('normalizePlugin', () => {
  it('rejects a bundle with no recognized layout', async () => {
    await expect(
      normalizePlugin(memoryFs({ 'README.md': '# hi' }), { fallbackName: 'x' }),
    ).rejects.toBeInstanceOf(InvalidPluginError);
  });

  it('normalizes a bare skill folder with the frontmatter name', async () => {
    const plugin = await normalizePlugin(
      memoryFs({ 'SKILL.md': SKILL.replace('name: lint', 'name: Lint Tools') }),
      { fallbackName: 'folder' },
    );
    expect(plugin.format).toBe('skill');
    expect(plugin.manifest).toEqual({ name: 'lint-tools', description: 'Lints code' });
    expect(plugin.components).toEqual([
      {
        kind: 'skill',
        name: 'Lint-Tools',
        description: 'Lints code',
        dir: '.',
        entry: 'SKILL.md',
        frontmatter: { name: 'Lint Tools', description: 'Lints code' },
      },
    ]);
    expect(plugin.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['renamed', 'renamed']);
    expect(Value.Check(NormalizedPluginSchema, plugin)).toBe(true);
  });

  it('falls back to the folder name and reports a skill without description', async () => {
    const plugin = await normalizePlugin(memoryFs({ 'SKILL.md': 'No frontmatter.' }), {
      fallbackName: 'My Skill',
    });
    expect(plugin.manifest.name).toBe('my-skill');
    expect(plugin.components).toEqual([]);
    expect(plugin.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-component', path: 'SKILL.md' }),
    );
  });

  it('rejects a skill folder whose name cannot be normalized', async () => {
    await expect(
      normalizePlugin(memoryFs({ 'SKILL.md': SKILL.replace('name: lint', 'name: "!!!"') }), {
        fallbackName: 'x',
      }),
    ).rejects.toBeInstanceOf(InvalidPluginError);
  });
});
