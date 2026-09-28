import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { InvalidPluginError, normalizePlugin } from '../../src/formats/index.js';
import { NormalizedPluginSchema } from '../../src/model/manifest.js';
import { memoryFs, type MemoryFsOptions } from '../helpers/memory-fs.js';

const MANIFEST = '.claude-plugin/plugin.json';
const skill = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\nBody\n`;
const agent = (frontmatter: string, body = 'You review code.') =>
  `---\n${frontmatter}\n---\n${body}\n`;

function load(files: Record<string, string>, options?: MemoryFsOptions) {
  return normalizePlugin(memoryFs(files, options), { fallbackName: 'Fallback Dir' });
}

const names = (plugin: Awaited<ReturnType<typeof load>>) =>
  plugin.components.map((component) => `${component.kind}:${component.name}`);

describe('Claude adapter: manifest', () => {
  it('loads a manifest-less plugin under the fallback name with default components', async () => {
    const plugin = await load({
      'skills/lint/SKILL.md': skill('lint'),
      'commands/db/migrate.md': '---\ndescription: Migrate\n---\nMigrate $ARGUMENTS',
      'commands/hello.md': 'Say hello to $0.',
      'agents/review/security.md': agent('description: Security review\ntools: Read, Grep'),
      'agents/plain.md': agent('name: Plain Agent\ndescription: Plain'),
    });
    expect(plugin.format).toBe('claude');
    expect(plugin.manifest).toEqual({ name: 'fallback-dir' });
    expect(names(plugin)).toEqual([
      'skill:lint',
      'command:db-migrate',
      'command:hello',
      'agent:Plain-Agent',
      'agent:review-security',
    ]);
    const hello = plugin.components.find((component) => component.name === 'hello');
    expect(hello).toMatchObject({
      description: 'Say hello to $0.',
      segments: [
        { type: 'text', text: 'Say hello to ' },
        { type: 'argument', index: 1 },
        { type: 'text', text: '.' },
      ],
    });
    const security = plugin.components.find((component) => component.name === 'review-security');
    expect(security).toEqual({
      kind: 'agent',
      name: 'review-security',
      description: 'Security review',
      tools: ['Read', 'Grep'],
      prompt: 'You review code.\n',
      source: 'agents/review/security.md',
    });
    expect(plugin.diagnostics.map((d) => `${d.code}:${d.path}`)).toEqual([
      'renamed:agents/plain.md',
    ]);
    expect(Value.Check(NormalizedPluginSchema, plugin)).toBe(true);
  });

  it('reads metadata, renames the plugin and reports unknown and unsupported fields', async () => {
    const plugin = await load({
      [MANIFEST]: JSON.stringify({
        name: 'Deploy_Tools',
        displayName: 'Deploy Tools',
        version: '1.0.0',
        repository: { url: 'https://github.com/x/y' },
        author: 'Ada Lovelace <ada@example.com> (https://ada.dev)',
        homepage: 42,
        hooks: './hooks.json',
        metadata: { id: 1 },
        defaultEnabled: false,
        surprise: true,
      }),
      'hooks/hooks.json': '{}',
      'bin/tool': '#!/bin/sh',
      '.lsp.json': '{}',
    });
    expect(plugin.manifest).toEqual({
      name: 'deploy-tools',
      displayName: 'Deploy Tools',
      version: '1.0.0',
      repository: 'https://github.com/x/y',
      author: { name: 'Ada Lovelace', email: 'ada@example.com', url: 'https://ada.dev' },
    });
    expect(plugin.diagnostics.map((d) => `${d.code}:${d.path ?? ''}`)).toEqual([
      `renamed:${MANIFEST}`,
      `unsupported-component:${MANIFEST}`,
      `unknown-field:${MANIFEST}`,
      `unknown-field:${MANIFEST}`,
      'unsupported-component:hooks',
      'unsupported-component:bin',
      'unsupported-component:.lsp.json',
    ]);
  });

  it.each([
    ['unparseable JSON', '{"name": '],
    ['a missing name', '{"description": "x"}'],
    ['a name with no usable characters', '{"name": "@@@"}'],
  ])('rejects a manifest with %s', async (_label, text) => {
    await expect(load({ [MANIFEST]: text })).rejects.toBeInstanceOf(InvalidPluginError);
  });
});

describe('Claude adapter: components', () => {
  it('adds manifest skills to the default scan, including the root and single-skill folders', async () => {
    const plugin = await load({
      [MANIFEST]: JSON.stringify({ name: 'kit', skills: ['./extra', '.', './skills/'] }),
      'SKILL.md': skill('root-skill'),
      'skills/a/SKILL.md': skill('a'),
      'extra/SKILL.md': skill('extra'),
    });
    expect(names(plugin)).toEqual(['skill:a', 'skill:extra', 'skill:root-skill']);
    expect(plugin.components[1]).toMatchObject({ dir: 'extra', entry: 'extra/SKILL.md' });
    expect(plugin.components[2]).toMatchObject({ dir: '.', entry: 'SKILL.md' });
  });

  it('uses a root SKILL.md only when there is no skills directory', async () => {
    const plugin = await load({ 'SKILL.md': skill('solo'), 'commands/x.md': 'X' });
    expect(names(plugin)).toEqual(['skill:solo', 'command:x']);
  });

  it('replaces the default command scan with manifest paths and object entries', async () => {
    const plugin = await load({
      [MANIFEST]: JSON.stringify({
        name: 'kit',
        commands: {
          status: { source: './cmds/status.md', argumentHint: '[env]', allowedTools: ['Bash'] },
          about: { content: 'Explain the plugin.', description: 'About' },
          broken: { source: './a.md', content: 'both' },
          outside: { source: './../x.md' },
          relative: { source: 'cmds/status.md' },
        },
      }),
      'commands/ignored.md': 'Ignored',
      'cmds/status.md': '---\ndescription: Status\nmodel: haiku\n---\nStatus for $0',
    });
    expect(names(plugin)).toEqual(['command:status', 'command:about']);
    expect(plugin.components[0]).toMatchObject({
      description: 'Status',
      argumentHint: '[env]',
      allowedTools: ['Bash'],
      model: 'haiku',
      source: 'cmds/status.md',
    });
    expect(plugin.components[1]).toMatchObject({ description: 'About', source: MANIFEST });
    expect(plugin.diagnostics.map((d) => d.code)).toEqual([
      'invalid-component',
      'path-escape',
      'invalid-component',
    ]);
  });

  it('reads command frontmatter arguments, allowed tools and shell blocks', async () => {
    const plugin = await load({
      'commands/fix.md': [
        '---',
        'argument-hint: "[issue] [branch]"',
        'arguments:',
        '  - issue',
        '  - name: branch',
        '    description: Target branch',
        'allowed-tools: Bash(git add:*), Bash(gh *) Read',
        '---',
        'Fix $issue on $branch.',
        'Status: !`git status`',
      ].join('\n'),
      'commands/fenced.md': 'Run\n```!\nnode --version\n```\n',
    });
    const fix = plugin.components.find((component) => component.name === 'fix');
    expect(fix).toMatchObject({
      description: 'Fix $issue on $branch.',
      argumentHint: '[issue] [branch]',
      arguments: [{ name: 'issue' }, { name: 'branch', description: 'Target branch' }],
      allowedTools: ['Bash(git add:*)', 'Bash(gh *)', 'Read'],
      segments: [
        { type: 'text', text: 'Fix ' },
        { type: 'named', name: 'issue' },
        { type: 'text', text: ' on ' },
        { type: 'named', name: 'branch' },
        { type: 'text', text: '.\nStatus: !`git status`' },
      ],
    });
    expect(plugin.diagnostics.map((d) => `${d.code}:${d.component?.name}`)).toEqual([
      'shell-injection:fenced',
      'shell-injection:fix',
    ]);
  });

  it('validates agents, drops unsupported fields and tolerates loose frontmatter', async () => {
    const plugin = await load({
      [MANIFEST]: JSON.stringify({
        name: 'kit',
        agents: ['./team/lead.md', './team/nodesc.md', './team/loose.md', './team'],
      }),
      'agents/ignored.md': agent('description: ignored'),
      'team/lead.md': agent(
        'name: lead\ndescription: Leads\nmodel: sonnet\nhooks: {}\npermissionMode: plan\nmemory: user',
      ),
      'team/nodesc.md': agent('name: nodesc'),
      'team/loose.md': agent('description: Handles: colons: badly\ntools: [Read'),
    });
    expect(names(plugin)).toEqual(['agent:lead', 'agent:loose']);
    expect(plugin.components[0]).toMatchObject({ model: 'sonnet', tools: [] });
    expect(plugin.components[1]).toMatchObject({ description: 'Handles: colons: badly' });
    expect(plugin.diagnostics.map((d) => `${d.level}:${d.code}:${d.path}`)).toEqual([
      'info:unsupported-component:team/lead.md',
      'warning:invalid-component:team/nodesc.md',
      'warning:invalid-component:team/loose.md',
      'warning:invalid-component:team',
    ]);
    expect(plugin.diagnostics[0]?.message).toContain('hooks, permissionMode, memory');
  });

  it('reports duplicate commands and component paths that escape through symlinks', async () => {
    const plugin = await load(
      {
        'commands/a-b.md': 'One',
        'commands/a/b.md': 'Two',
      },
      { escapes: { 'commands/linked.md': 'file', agents: 'dir' } },
    );
    expect(names(plugin)).toEqual(['command:a-b']);
    expect(plugin.components[0]).toMatchObject({ source: 'commands/a/b.md' });
    expect(plugin.diagnostics.map((d) => `${d.code}:${d.path}`)).toEqual([
      'duplicate:commands/a-b.md',
      'path-escape:commands/linked.md',
      'path-escape:agents',
    ]);
  });
});
