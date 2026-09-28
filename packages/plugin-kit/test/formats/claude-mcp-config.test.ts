import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { normalizePlugin } from '../../src/formats/index.js';
import { NormalizedPluginSchema } from '../../src/model/manifest.js';
import { memoryFs } from '../helpers/memory-fs.js';

const MANIFEST = '.claude-plugin/plugin.json';

function load(manifest: Record<string, unknown>, files: Record<string, string> = {}) {
  return normalizePlugin(
    memoryFs({ [MANIFEST]: JSON.stringify({ name: 'kit', ...manifest }), ...files }),
    { fallbackName: 'kit' },
  );
}

describe('Claude adapter: MCP servers', () => {
  it('merges .mcp.json with manifest declarations, later declarations winning', async () => {
    const plugin = await load(
      {
        mcpServers: [
          './config/extra.json',
          { db: { command: 'npx', args: ['db-server'], env: { URL: '${DB_URL:-x}' } } },
        ],
      },
      {
        '.mcp.json': JSON.stringify({
          mcpServers: {
            db: { command: 'old' },
            api: { type: 'http', url: 'https://api.example.com/mcp', headers: { A: 'b' } },
          },
        }),
        'config/extra.json': JSON.stringify({
          events: { type: 'sse', url: 'https://events.example.com/sse' },
          local: {
            command: '${CLAUDE_PLUGIN_ROOT}/bin/server',
            cwd: '${CLAUDE_PLUGIN_ROOT}',
          },
        }),
      },
    );
    expect(plugin.components).toEqual([
      {
        kind: 'mcp',
        name: 'db',
        source: MANIFEST,
        transport: {
          type: 'stdio',
          command: 'npx',
          args: ['db-server'],
          env: { URL: '${DB_URL:-x}' },
        },
      },
      {
        kind: 'mcp',
        name: 'api',
        source: '.mcp.json',
        transport: {
          type: 'http',
          protocol: 'streamable-http',
          url: 'https://api.example.com/mcp',
          headers: { A: 'b' },
        },
      },
      {
        kind: 'mcp',
        name: 'events',
        source: 'config/extra.json',
        transport: {
          type: 'http',
          protocol: 'sse',
          url: 'https://events.example.com/sse',
          headers: {},
        },
      },
      {
        kind: 'mcp',
        name: 'local',
        source: 'config/extra.json',
        transport: {
          type: 'stdio',
          command: '${CLAUDE_PLUGIN_ROOT}/bin/server',
          args: [],
          env: {},
          cwd: '${CLAUDE_PLUGIN_ROOT}',
        },
      },
    ]);
    expect(plugin.diagnostics).toEqual([]);
    expect(Value.Check(NormalizedPluginSchema, plugin)).toBe(true);
  });

  it('skips unsupported transports, bundles and invalid entries with diagnostics', async () => {
    const plugin = await load(
      {
        mcpServers: [
          './bundle.mcpb',
          'https://example.com/server.dxt',
          './../outside.json',
          {
            socket: { type: 'ws', url: 'wss://example.com' },
            helper: { type: 'http', url: 'https://x.example.com', headersHelper: './h.sh' },
            oauth: { type: 'http', url: 'https://x.example.com', oauth: { clientId: 'a' } },
            nocommand: { args: ['x'] },
            badurl: { type: 'http', url: 'not a url' },
            weird: { type: 'grpc' },
            'odd name!': { command: 'node' },
          },
        ],
      },
      { '.mcp.json': '{ not json' },
    );
    expect(plugin.components.map((component) => component.name)).toEqual(['odd-name']);
    expect(plugin.diagnostics.map((d) => `${d.code}:${d.component?.name ?? d.path}`)).toEqual([
      'invalid-component:.mcp.json',
      `unsupported-transport:${MANIFEST}`,
      `unsupported-transport:${MANIFEST}`,
      'path-escape:./../outside.json',
      'unsupported-transport:socket',
      'unsupported-transport:helper',
      'unsupported-transport:oauth',
      'invalid-component:nocommand',
      'invalid-component:badurl',
      'invalid-component:weird',
      'renamed:odd-name',
    ]);
  });
});

describe('Claude adapter: userConfig', () => {
  it('parses options and skips invalid ones', async () => {
    const plugin = await load({
      userConfig: {
        api_token: {
          type: 'string',
          title: 'API token',
          description: 'Token for the API',
          sensitive: true,
          required: true,
        },
        region: { type: 'string', title: 'Region', options: ['eu', 'us'], default: 'eu' },
        retries: { type: 'number', title: 'Retries', min: 0, max: 5, default: 2 },
        tags: { type: 'string', title: 'Tags', multiple: true },
        '1bad': { type: 'string', title: 'Bad key' },
        typo: { type: 'string', title: 'Typo', sensitiv: true },
        wrongType: { type: 'list', title: 'Wrong' },
        badFlag: { type: 'boolean', title: 'Flag', required: 'yes' },
      },
    });
    expect(plugin.userConfig).toEqual([
      {
        key: 'api_token',
        type: 'string',
        title: 'API token',
        description: 'Token for the API',
        required: true,
        sensitive: true,
      },
      {
        key: 'region',
        type: 'string',
        title: 'Region',
        required: false,
        sensitive: false,
        default: 'eu',
        options: ['eu', 'us'],
      },
      {
        key: 'retries',
        type: 'number',
        title: 'Retries',
        required: false,
        sensitive: false,
        default: 2,
        min: 0,
        max: 5,
      },
      { key: 'tags', type: 'string', title: 'Tags', required: false, sensitive: false },
    ]);
    expect(plugin.diagnostics.map((d) => `${d.code}:${d.message.split(':')[0]}`)).toEqual([
      'unsupported-component:userConfig "tags"',
      'invalid-component:userConfig "1bad"',
      'invalid-component:userConfig "typo"',
      'invalid-component:userConfig "wrongType"',
      'invalid-component:userConfig "badFlag"',
    ]);
    expect(Value.Check(NormalizedPluginSchema, plugin)).toBe(true);
  });

  it('ignores a non-object userConfig with a diagnostic', async () => {
    const plugin = await load({ userConfig: ['x'] });
    expect(plugin.userConfig).toEqual([]);
    expect(plugin.diagnostics).toEqual([
      expect.objectContaining({ code: 'invalid-component', path: MANIFEST }),
    ]);
  });
});
