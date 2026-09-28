import { describe, expect, it } from 'vitest';
import type { McpTransport } from '../../src/model/manifest.js';
import { substituteTransport, type SubstitutionContext } from '../../src/substitute/index.js';

const ROOT = '/plugins/revs/abc';
const DATA = '/plugins/data/demo';

function context(overrides: Partial<SubstitutionContext> = {}): SubstitutionContext {
  return {
    root: ROOT,
    data: DATA,
    config: {},
    sensitive: new Set(),
    env: {},
    ...overrides,
  };
}

function stdio(overrides: Partial<Extract<McpTransport, { type: 'stdio' }>> = {}): McpTransport {
  return { type: 'stdio', command: 'node', args: [], env: {}, ...overrides };
}

const INJECTED = {
  PLUGIN_ROOT: ROOT,
  PLUGIN_DATA: DATA,
  CLAUDE_PLUGIN_ROOT: ROOT,
  CLAUDE_PLUGIN_DATA: DATA,
};

describe('substituteTransport: agent-plugins', () => {
  it('expands plugin directories in args, env values and cwd only', () => {
    const { transport, diagnostics } = substituteTransport(
      'agent-plugins',
      stdio({
        command: '${PLUGIN_ROOT}/bin/server',
        args: ['--root=${PLUGIN_ROOT}', '${PLUGIN_DATA}/cache', '${HOME}', '${user_config.KEY}'],
        env: { '${PLUGIN_ROOT}': 'key-stays', CACHE: '${PLUGIN_DATA}/c' },
        cwd: '${PLUGIN_DATA}/work',
      }),
      context({ env: { HOME: '/home/me' }, config: { KEY: 'v' } }),
    );
    expect(diagnostics).toEqual([]);
    expect(transport).toEqual({
      type: 'stdio',
      command: '${PLUGIN_ROOT}/bin/server',
      args: [`--root=${ROOT}`, `${DATA}/cache`, '${HOME}', '${user_config.KEY}'],
      env: { '${PLUGIN_ROOT}': 'key-stays', CACHE: `${DATA}/c`, ...INJECTED },
      cwd: `${DATA}/work`,
    });
  });

  it('does not expand text that an expansion produced', () => {
    const { transport } = substituteTransport(
      'agent-plugins',
      stdio({ args: ['${PLUGIN_ROOT}'] }),
      context({ root: '/weird/${PLUGIN_DATA}' }),
    );
    expect(transport.type === 'stdio' && transport.args).toEqual(['/weird/${PLUGIN_DATA}']);
  });

  it('never touches http urls or headers', () => {
    const http: McpTransport = {
      type: 'http',
      protocol: 'streamable-http',
      url: 'https://x.test/${PLUGIN_ROOT}',
      headers: { Authorization: 'Bearer ${PLUGIN_DATA}' },
    };
    expect(substituteTransport('agent-plugins', http, context())).toEqual({
      transport: http,
      diagnostics: [],
    });
  });

  it('resolves ./ commands and cwd against the root and keeps bare commands', () => {
    const local = substituteTransport(
      'agent-plugins',
      stdio({ command: './bin//server', cwd: './work/' }),
      context({ root: `${ROOT}/` }),
    ).transport;
    expect(local).toMatchObject({ command: `${ROOT}/bin/server`, cwd: `${ROOT}/work` });
    const bare = substituteTransport('agent-plugins', stdio({ command: 'npx' }), context());
    expect(bare.transport).toMatchObject({ command: 'npx', cwd: ROOT });
  });

  it('rejects .. in cwd and ./ commands, leaving them unresolved', () => {
    const { transport, diagnostics } = substituteTransport(
      'agent-plugins',
      stdio({ command: './../escape', cwd: '${PLUGIN_ROOT}/../elsewhere' }),
      context(),
    );
    expect(transport).toMatchObject({ command: './../escape', cwd: `${ROOT}/../elsewhere` });
    expect(diagnostics.map((d) => [d.level, d.code])).toEqual([
      ['error', 'invalid-component'],
      ['error', 'invalid-component'],
    ]);
  });

  it('lets injected directory variables win over declared env', () => {
    const { transport } = substituteTransport(
      'agent-plugins',
      stdio({ env: { PLUGIN_ROOT: '/fake', OTHER: '1' } }),
      context(),
    );
    expect(transport.type === 'stdio' && transport.env).toEqual({ OTHER: '1', ...INJECTED });
  });
});

describe('substituteTransport: claude', () => {
  it('expands directories, user config and env everywhere in stdio', () => {
    const { transport, diagnostics } = substituteTransport(
      'claude',
      stdio({
        command: '${CLAUDE_PLUGIN_ROOT}/bin/${TOOL}',
        args: ['--token=${user_config.TOKEN}', '--port=${user_config.PORT}'],
        env: { '${PREFIX}_HOME': '${CLAUDE_PLUGIN_DATA}' },
        cwd: '${CLAUDE_PLUGIN_ROOT}/srv',
      }),
      context({
        env: { TOOL: 'server', PREFIX: 'APP' },
        config: { TOKEN: 's3cret', PORT: 8080 },
        sensitive: new Set(['TOKEN']),
      }),
    );
    expect(diagnostics).toEqual([]);
    expect(transport).toEqual({
      type: 'stdio',
      command: `${ROOT}/bin/server`,
      args: ['--token=s3cret', '--port=8080'],
      env: { APP_HOME: DATA, ...INJECTED },
      cwd: `${ROOT}/srv`,
    });
  });

  it('applies :- defaults when the variable is unset or empty', () => {
    const { transport, diagnostics } = substituteTransport(
      'claude',
      stdio({ args: ['${A:-one}', '${B:-two}', '${C:-three}', '${D:-}', '${E}'] }),
      context({ env: { A: 'set', B: '', E: '' } }),
    );
    expect(diagnostics).toEqual([]);
    expect(transport.type === 'stdio' && transport.args).toEqual(['set', 'two', 'three', '', '']);
  });

  it('expands http url and header values', () => {
    const { transport } = substituteTransport(
      'claude',
      {
        type: 'http',
        protocol: 'sse',
        url: '${BASE:-https://api.test}/mcp',
        headers: { Authorization: 'Bearer ${user_config.TOKEN}' },
      },
      context({ config: { TOKEN: 't' } }),
    );
    expect(transport).toEqual({
      type: 'http',
      protocol: 'sse',
      url: 'https://api.test/mcp',
      headers: { Authorization: 'Bearer t' },
    });
  });

  it('keeps unresolved references literal and reports each once', () => {
    const { transport, diagnostics } = substituteTransport(
      'claude',
      stdio({
        args: ['${user_config.MISSING}', '${user_config.MISSING}', '${UNSET}', '${not valid}'],
        env: { X: '${constructor}' },
      }),
      context(),
    );
    expect(transport).toMatchObject({
      args: ['${user_config.MISSING}', '${user_config.MISSING}', '${UNSET}', '${not valid}'],
      env: { X: '${constructor}' },
    });
    expect(diagnostics.map((d) => [d.level, d.code])).toEqual([
      ['warning', 'needs-config'],
      ['warning', 'invalid-component'],
      ['warning', 'invalid-component'],
    ]);
    expect(diagnostics[0]?.message).toContain('user_config.MISSING');
    expect(diagnostics[1]?.message).toContain('UNSET');
  });

  it('is a single pass over values from env and config', () => {
    const { transport } = substituteTransport(
      'claude',
      stdio({ args: ['${A}', '${user_config.K}'] }),
      context({ env: { A: '${CLAUDE_PLUGIN_ROOT}' }, config: { K: '${A}' } }),
    );
    expect(transport.type === 'stdio' && transport.args).toEqual(['${CLAUDE_PLUGIN_ROOT}', '${A}']);
  });
});

describe('substituteTransport: formats without MCP', () => {
  it.each(['pi', 'skill'] as const)('returns %s transports unchanged', (format) => {
    const transport = stdio({ command: './x', args: ['${PLUGIN_ROOT}'] });
    const result = substituteTransport(format, transport, context());
    expect(result.transport).toBe(transport);
    expect(result.diagnostics).toEqual([]);
  });
});
