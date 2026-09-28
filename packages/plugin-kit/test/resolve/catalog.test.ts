import { describe, expect, it } from 'vitest';
import type { PluginComponent, UserConfigOption } from '../../src/model/manifest.js';
import type { HostPlugin, InstalledPlugin, PluginStateFile } from '../../src/model/records.js';
import { resolveCatalog, type ResolveInput } from '../../src/resolve/catalog.js';

function state(overrides: Partial<PluginStateFile> = {}): PluginStateFile {
  return { version: 1, disabled: [], items: {}, config: {}, approved: {}, ...overrides };
}

function skill(name: string): PluginComponent {
  const dir = `skills/${name}`;
  return { kind: 'skill', name, description: '', dir, entry: `${dir}/SKILL.md`, frontmatter: {} };
}

function stdioMcp(name: string): PluginComponent {
  const transport = { type: 'stdio' as const, command: 'node', args: [], env: {} };
  return { kind: 'mcp', name, transport, source: '.mcp.json' };
}

function httpMcp(name: string): PluginComponent {
  const transport = {
    type: 'http' as const,
    protocol: 'streamable-http' as const,
    url: 'https://x.test',
    headers: {},
  };
  return { kind: 'mcp', name, transport, source: '.mcp.json' };
}

function option(key: string, overrides: Partial<UserConfigOption> = {}): UserConfigOption {
  return { key, type: 'string', required: true, sensitive: false, ...overrides };
}

function installed(
  id: string,
  components: PluginComponent[],
  userConfig: UserConfigOption[] = [],
): InstalledPlugin {
  const manifest = { name: id, displayName: `${id} plugin`, version: '1.0.0', license: 'MIT' };
  return {
    id,
    source: { kind: 'local', path: `/src/${id}` },
    resolved: {},
    revision: '0123456789abcdef',
    plugin: { format: 'claude', manifest, components, userConfig, diagnostics: [] },
    installedAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
  };
}

function host(id: string, items: HostPlugin['items'], toggleable = true): HostPlugin {
  return { id, name: id, description: `${id} items`, toggleable, items };
}

function resolve(input: Partial<ResolveInput>) {
  return resolveCatalog({ host: [], installed: [], state: state(), secretsSet: {}, ...input });
}

describe('resolveCatalog', () => {
  it('orders host plugins as given, then installed plugins by id', () => {
    const catalog = resolve({
      host: [host('user', []), host('builtin:core', [])],
      installed: [installed('zeta', [skill('z')]), installed('alpha', [skill('a'), skill('b')])],
    });
    expect(catalog.plugins.map((p) => p.id)).toEqual(['user', 'builtin:core', 'alpha', 'zeta']);
    expect(catalog.items.map((i) => i.name)).toEqual(['alpha:a', 'alpha:b', 'zeta:z']);
  });

  it('describes host plugins with bare item names and their own switches', () => {
    const catalog = resolve({
      host: [
        host(
          'builtin:core',
          [
            { kind: 'skill', name: 'plan', enabled: true },
            { kind: 'memory', name: 'hermes', enabled: false },
          ],
          false,
        ),
      ],
      state: state({ disabled: ['builtin:core'] }),
    });
    expect(catalog.plugins[0]).toEqual({
      id: 'builtin:core',
      origin: 'host',
      name: 'builtin:core',
      description: 'builtin:core items',
      enabled: true,
      toggleable: false,
      removable: false,
      updatable: false,
      needsConfig: false,
      counts: { skill: 1, agent: 0, command: 0, mcp: 0, memory: 1 },
      diagnostics: [],
    });
    expect(catalog.items).toEqual([
      {
        pluginId: 'builtin:core',
        kind: 'skill',
        localName: 'plan',
        name: 'plan',
        itemEnabled: true,
        enabled: true,
      },
      {
        pluginId: 'builtin:core',
        kind: 'memory',
        localName: 'hermes',
        name: 'hermes',
        itemEnabled: false,
        enabled: false,
        blockedBy: 'item',
      },
    ]);
  });

  it('blocks every item of a disabled toggleable host plugin', () => {
    const catalog = resolve({
      host: [host('shared', [{ kind: 'skill', name: 's', enabled: false }])],
      state: state({ disabled: ['shared'] }),
    });
    expect(catalog.plugins[0]?.enabled).toBe(false);
    expect(catalog.items[0]).toMatchObject({ enabled: false, blockedBy: 'plugin' });
  });

  it('maps installed manifests and state into the plugin summary', () => {
    const plugin = installed('demo', [skill('a'), stdioMcp('db'), httpMcp('api')]);
    plugin.plugin.diagnostics.push({ level: 'info', code: 'unknown-field', message: 'x' });
    const catalog = resolve({
      installed: [plugin],
      state: state({ items: { demo: ['skill:a'] }, approved: { demo: ['db'] } }),
    });
    expect(catalog.plugins[0]).toEqual({
      id: 'demo',
      origin: 'installed',
      name: 'demo',
      displayName: 'demo plugin',
      description: '',
      version: '1.0.0',
      format: 'claude',
      source: { kind: 'local', path: '/src/demo' },
      revision: '0123456789abcdef',
      license: 'MIT',
      installedAt: '2026-09-28T00:00:00.000Z',
      enabled: true,
      toggleable: true,
      removable: true,
      updatable: true,
      needsConfig: false,
      counts: { skill: 1, agent: 0, command: 0, mcp: 2, memory: 0 },
      diagnostics: [{ level: 'info', code: 'unknown-field', message: 'x' }],
    });
    expect(catalog.items.map((i) => [i.name, i.localName, i.itemEnabled, i.blockedBy])).toEqual([
      ['demo:a', 'a', false, 'item'],
      ['demo:db', 'db', true, undefined],
      ['demo:api', 'api', true, undefined],
    ]);
  });

  it('requires approval only for stdio MCP servers', () => {
    const catalog = resolve({ installed: [installed('demo', [stdioMcp('db'), httpMcp('api')])] });
    expect(catalog.items.map((i) => [i.name, i.enabled, i.blockedBy])).toEqual([
      ['demo:db', false, 'approval'],
      ['demo:api', true, undefined],
    ]);
  });

  it('applies blockers in precedence order: plugin, item, config, approval', () => {
    const config = [option('TOKEN')];
    const components = [stdioMcp('db'), stdioMcp('off')];
    const blockers = (overrides: Partial<PluginStateFile>) =>
      resolve({
        installed: [installed('demo', components, config)],
        state: state(overrides),
      }).items.map((i) => i.blockedBy);
    expect(blockers({ disabled: ['demo'], items: { demo: ['mcp:off'] } })).toEqual([
      'plugin',
      'plugin',
    ]);
    expect(blockers({ items: { demo: ['mcp:off'] } })).toEqual(['config', 'item']);
    expect(blockers({ config: { demo: { TOKEN: 't' } } })).toEqual(['approval', 'approval']);
    expect(blockers({ config: { demo: { TOKEN: 't' } }, approved: { demo: ['db'] } })).toEqual([
      undefined,
      'approval',
    ]);
  });

  it('computes needsConfig from stored values, stored secrets and defaults', () => {
    const userConfig = [
      option('REGION'),
      option('API_KEY', { sensitive: true }),
      option('PORT', { default: 8080 }),
      option('NOTE', { required: false }),
    ];
    const run = (overrides: Partial<ResolveInput>) =>
      resolve({ installed: [installed('demo', [skill('a')], userConfig)], ...overrides })
        .plugins[0];

    const missing = run({});
    expect(missing?.needsConfig).toBe(true);
    expect(missing?.diagnostics).toEqual([
      {
        level: 'warning',
        code: 'needs-config',
        message: 'Required settings are missing: REGION, API_KEY.',
      },
    ]);
    // A sensitive value in plain state does not count; only the secret store does.
    expect(
      run({ state: state({ config: { demo: { REGION: 'eu', API_KEY: 'leak' } } }) })?.needsConfig,
    ).toBe(true);
    const configured = run({
      state: state({ config: { demo: { REGION: 'eu' } } }),
      secretsSet: { demo: ['API_KEY'] },
    });
    expect(configured?.needsConfig).toBe(false);
    expect(configured?.diagnostics).toEqual([]);
  });

  it('keeps a qualified name with its first owner and reports later ones', () => {
    const catalog = resolve({
      host: [
        host('first', [{ kind: 'skill', name: 'shared', enabled: false }]),
        host('second', [
          { kind: 'skill', name: 'shared', enabled: true },
          { kind: 'command', name: 'shared', enabled: true },
        ]),
        host('third', [{ kind: 'skill', name: 'shared', enabled: false }]),
      ],
      state: state({ disabled: ['first'] }),
    });
    expect(catalog.items.map((i) => [i.pluginId, i.kind, i.enabled, i.blockedBy])).toEqual([
      ['first', 'skill', false, 'plugin'],
      ['second', 'skill', false, 'collision'],
      ['second', 'command', true, undefined],
      ['third', 'skill', false, 'item'],
    ]);
    const diagnostics = catalog.plugins.map((p) => p.diagnostics.map((d) => d.code));
    expect(diagnostics).toEqual([[], ['collision'], ['collision']]);
    expect(catalog.plugins[1]?.diagnostics[0]).toMatchObject({
      level: 'warning',
      component: { kind: 'skill', name: 'shared' },
    });
    expect(catalog.plugins[1]?.diagnostics[0]?.message).toContain('"first"');
  });

  it('lets host items claim a name before installed ones', () => {
    const catalog = resolve({
      host: [host('user', [{ kind: 'skill', name: 'demo:a', enabled: true }])],
      installed: [installed('demo', [skill('a')])],
    });
    expect(catalog.items.map((i) => [i.pluginId, i.blockedBy])).toEqual([
      ['user', undefined],
      ['demo', 'collision'],
    ]);
    expect(catalog.plugins[1]?.diagnostics.map((d) => d.code)).toEqual(['collision']);
  });

  it('ignores prototype keys when reading state', () => {
    const catalog = resolve({ installed: [installed('constructor', [skill('a')])] });
    expect(catalog.items[0]).toMatchObject({ itemEnabled: true, enabled: true });
  });
});
