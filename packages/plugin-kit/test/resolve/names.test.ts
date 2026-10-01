import { describe, expect, it } from 'vitest';
import type { PluginFormat } from '../../src/model/manifest.js';
import type { InstalledPlugin } from '../../src/model/records.js';
import { resolveCatalog } from '../../src/resolve/catalog.js';
import { installedItemName } from '../../src/resolve/names.js';

function installed(id: string, format: PluginFormat, skillName: string): InstalledPlugin {
  const dir = format === 'skill' ? '.' : `skills/${skillName}`;
  return {
    id,
    source: { kind: 'local', path: `/src/${id}` },
    resolved: {},
    revision: '0123456789abcdef',
    plugin: {
      format,
      manifest: { name: id },
      components: [
        {
          kind: 'skill',
          name: skillName,
          description: '',
          dir,
          entry: `${dir}/SKILL.md`,
          frontmatter: {},
        },
      ],
      userConfig: [],
      diagnostics: [],
    },
    installedAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
  };
}

describe('installedItemName', () => {
  it('qualifies bundle items and keeps a standalone skill bare', () => {
    expect(installedItemName(installed('kit', 'claude', 'review'), 'review')).toBe('kit:review');
    expect(installedItemName(installed('notes', 'skill', 'Notes'), 'Notes')).toBe('Notes');
  });

  it('lets a standalone skill collide with a host item of the same bare name', () => {
    const catalog = resolveCatalog({
      host: [
        {
          id: 'user',
          name: 'Personal',
          description: '',
          toggleable: false,
          items: [{ kind: 'skill', name: 'notes', enabled: true }],
        },
      ],
      installed: [installed('notes', 'skill', 'notes')],
      state: { version: 1, disabled: [], items: {}, config: {} },
      secretsSet: {},
    });
    const standalone = catalog.items.find((item) => item.pluginId === 'notes');
    expect(standalone).toMatchObject({ name: 'notes', enabled: false, blockedBy: 'collision' });
  });
});
