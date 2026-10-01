import { describe, expect, it } from 'vitest';
import type {
  PluginItemKind,
  ResolvedCatalog,
  ResolvedItem,
  ResolvedPlugin,
} from '../../src/model/records.js';
import { createRunSnapshot } from '../../src/resolve/snapshot.js';

function plugin(id: string, origin: ResolvedPlugin['origin'], enabled = true): ResolvedPlugin {
  return {
    id,
    origin,
    name: id,
    description: '',
    enabled,
    toggleable: true,
    removable: origin === 'installed',
    updatable: origin === 'installed',
    needsConfig: false,
    counts: { skill: 0, agent: 0, command: 0, mcp: 0, memory: 0 },
    diagnostics: [],
  };
}

function item(
  pluginId: string,
  kind: PluginItemKind,
  name: string,
  blockedBy?: ResolvedItem['blockedBy'],
): ResolvedItem {
  const base = {
    pluginId,
    kind,
    localName: name.split(':').pop() ?? name,
    name,
    itemEnabled: true,
  };
  return blockedBy === undefined
    ? { ...base, enabled: true }
    : { ...base, enabled: false, blockedBy };
}

const catalog: ResolvedCatalog = {
  plugins: [
    plugin('builtin:core', 'host'),
    plugin('beta', 'installed'),
    plugin('alpha', 'installed'),
    plugin('idle', 'installed'),
    plugin('off', 'installed', false),
    plugin('unpinned', 'installed'),
  ],
  items: [
    item('builtin:core', 'skill', 'plan'),
    item('builtin:core', 'memory', 'hermes'),
    item('beta', 'skill', 'beta:z'),
    item('beta', 'mcp', 'beta:db', 'config'),
    item('beta', 'skill', 'beta:a'),
    item('alpha', 'command', 'alpha:go'),
    item('idle', 'agent', 'idle:x', 'collision'),
    item('off', 'skill', 'off:s', 'plugin'),
    item('unpinned', 'agent', 'unpinned:helper'),
  ],
};

const revisions = {
  'builtin:core': 'ffffffffffffffff',
  beta: 'bbbbbbbbbbbbbbbb',
  alpha: 'aaaaaaaaaaaaaaaa',
  idle: 'cccccccccccccccc',
  off: 'dddddddddddddddd',
};

describe('createRunSnapshot', () => {
  it('pins enabled installed plugins that contribute an effective item', () => {
    expect(createRunSnapshot(catalog, revisions).plugins).toEqual([
      { id: 'beta', revision: 'bbbbbbbbbbbbbbbb' },
      { id: 'alpha', revision: 'aaaaaaaaaaaaaaaa' },
    ]);
  });

  it('lists effective items by kind in catalog order, with every kind present', () => {
    expect(createRunSnapshot(catalog, revisions).items).toEqual({
      skill: ['plan', 'beta:z', 'beta:a'],
      agent: ['unpinned:helper'],
      command: ['alpha:go'],
      mcp: [],
      memory: ['hermes'],
    });
  });

  it('is deterministic for equal catalogs', () => {
    const copy = structuredClone(catalog);
    expect(createRunSnapshot(copy, { ...revisions })).toEqual(
      createRunSnapshot(catalog, revisions),
    );
    expect(JSON.stringify(createRunSnapshot(copy, revisions))).toBe(
      JSON.stringify(createRunSnapshot(catalog, revisions)),
    );
  });

  it('returns empty groups for an empty catalog', () => {
    expect(createRunSnapshot({ plugins: [], items: [] }, {})).toEqual({
      plugins: [],
      items: { skill: [], agent: [], command: [], mcp: [], memory: [] },
    });
  });
});
