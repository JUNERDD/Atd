import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { InvalidPluginError, normalizePlugin } from '../../src/formats/index.js';
import { NormalizedPluginSchema } from '../../src/model/manifest.js';
import { memoryFs, type MemoryFsOptions } from '../helpers/memory-fs.js';

const SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const skill = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\nBody\n`;

function bundle(
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
  options?: MemoryFsOptions,
) {
  return memoryFs(
    { 'plugin.json': JSON.stringify({ $schema: SCHEMA, name: 'kit', ...manifest }), ...files },
    options,
  );
}

const load = (fs: ReturnType<typeof memoryFs>) => normalizePlugin(fs, { fallbackName: 'fallback' });

function mcp(servers: Record<string, unknown>) {
  return { 'mcp.json': JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: servers }) };
}

describe('Agent Plugins adapter', () => {
  it('loads metadata, one-level skills and MCP servers', async () => {
    const plugin = await load(
      bundle(
        {
          version: '1.2.0',
          description: 'Kit',
          repository: 'https://example.com/kit.git',
          author: { name: 'Ada', email: 'ada@example.com' },
          keywords: ['a', 'b'],
        },
        {
          'skills/review/SKILL.md': skill('review'),
          'skills/review/nested/SKILL.md': skill('nested'),
          'skills/SKILL.md': skill('top'),
          ...mcp({
            local: {
              type: 'stdio',
              command: './bin/server',
              args: ['--root', '${PLUGIN_ROOT}'],
              env: { TOKEN: 'x' },
              cwd: '${PLUGIN_DATA}/work',
            },
            remote: { type: 'streamable-http', url: 'https://mcp.example.com/v1', headers: {} },
            legacy: { type: 'sse', url: 'http://127.0.0.1:8080/sse' },
          }),
        },
      ),
    );
    expect(plugin.format).toBe('agent-plugins');
    expect(plugin.manifest).toEqual({
      name: 'kit',
      version: '1.2.0',
      description: 'Kit',
      repository: 'https://example.com/kit.git',
      author: { name: 'Ada', email: 'ada@example.com' },
      keywords: ['a', 'b'],
    });
    expect(plugin.components.map((component) => `${component.kind}:${component.name}`)).toEqual([
      'skill:review',
      'mcp:local',
      'mcp:remote',
      'mcp:legacy',
    ]);
    expect(plugin.components[1]).toEqual({
      kind: 'mcp',
      name: 'local',
      source: 'mcp.json',
      transport: {
        type: 'stdio',
        command: './bin/server',
        args: ['--root', '${PLUGIN_ROOT}'],
        env: { TOKEN: 'x' },
        cwd: '${PLUGIN_DATA}/work',
      },
    });
    expect(plugin.components[3]).toMatchObject({ transport: { type: 'http', protocol: 'sse' } });
    expect(plugin.diagnostics).toEqual([]);
    expect(Value.Check(NormalizedPluginSchema, plugin)).toBe(true);
  });

  it.each([
    ['a missing name', { name: undefined }],
    ['an invalid name', { name: 'Bad--Name' }],
    ['a foreign schema', { $schema: 'https://agent-plugins.org/schemas/2.0.0/plugin.schema.json' }],
    ['a wrongly typed field', { version: 3 }],
    ['non-object extensions', { extensions: [] }],
  ])('rejects %s', async (_label, manifest) => {
    await expect(load(bundle(manifest))).rejects.toBeInstanceOf(InvalidPluginError);
  });

  it('rejects unparseable plugin.json with an invalid-manifest diagnostic', async () => {
    const error = await load(memoryFs({ 'plugin.json': `{"$schema": "${SCHEMA}", ` })).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(InvalidPluginError);
    expect((error as InvalidPluginError).diagnostics[0]).toMatchObject({
      code: 'invalid-manifest',
    });
  });

  it('warns about unknown fields, other 1.x schemas, extensions and extension dirs', async () => {
    const plugin = await load(
      bundle(
        {
          $schema: 'https://agent-plugins.org/schemas/1.1.0/plugin.schema.json',
          hooks: {},
          extensions: { 'com.example': {} },
        },
        { 'com.example/tool.json': '{}', 'docs/readme.md': '' },
      ),
    );
    expect(plugin.diagnostics.map((d) => [d.level, d.code])).toEqual([
      ['warning', 'unknown-field'],
      ['warning', 'unknown-field'],
      ['info', 'unsupported-component'],
      ['info', 'unsupported-component'],
    ]);
  });

  it('skips invalid MCP servers with diagnostics and keeps valid ones', async () => {
    const plugin = await load(
      bundle(
        {},
        {
          'mcp.json': JSON.stringify({
            $schema: 'https://agent-plugins.org/schemas/1.1.0/mcp.schema.json',
            mcpServers: {
              ok: { type: 'stdio', command: 'node' },
              shell: { type: 'stdio', command: 'node server.js' },
              escape: { type: 'stdio', command: './../outside' },
              reserved: { type: 'stdio', command: 'node', env: { PLUGIN_ROOT: '/x' } },
              badCwd: { type: 'stdio', command: 'node', cwd: '/tmp' },
              escapeCwd: { type: 'stdio', command: 'node', cwd: '${PLUGIN_ROOT}/../x' },
              plain: { type: 'streamable-http', url: 'http://example.com/mcp' },
              creds: { type: 'streamable-http', url: 'https://user:pw@example.com/mcp' },
              fragment: { type: 'sse', url: 'https://example.com/mcp#x' },
              noType: { command: 'node' },
              ws: { type: 'ws', url: 'wss://example.com' },
              extra: { type: 'stdio', command: 'uvx', timeout: 5 },
            },
          }),
        },
      ),
    );
    expect(plugin.components.map((component) => component.name)).toEqual(['ok', 'extra']);
    const codes = plugin.diagnostics.map((d) => `${d.code}:${d.component?.name ?? ''}`);
    expect(codes).toEqual([
      'unknown-field:',
      'invalid-component:shell',
      'path-escape:escape',
      'invalid-component:reserved',
      'invalid-component:badCwd',
      'path-escape:escapeCwd',
      'invalid-component:plain',
      'invalid-component:creds',
      'invalid-component:fragment',
      'invalid-component:noType',
      'invalid-component:ws',
      'unknown-field:',
    ]);
  });

  it('reports duplicate and renamed skills and path escapes through symlinks', async () => {
    const plugin = await load(
      bundle(
        {},
        {
          'skills/a/SKILL.md': skill('same'),
          'skills/b/SKILL.md': skill('same'),
          'skills/c/SKILL.md': skill('has space'),
        },
        { escapes: { 'skills/linked': 'dir' } },
      ),
    );
    expect(plugin.components.map((component) => component.name)).toEqual(['same', 'has-space']);
    expect(plugin.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['duplicate', 'skills/b/SKILL.md'],
      ['renamed', 'skills/c/SKILL.md'],
      ['path-escape', 'skills/linked/SKILL.md'],
    ]);
  });
});
