import { useTranslation } from 'react-i18next';
import type { PluginSummary } from '@atd/agent-contracts';
import type { PluginSourceBadge } from './plugin-rows';

type HostKey = 'core' | 'personal' | 'shared';

/** Host plugins this app ships, named in the UI language rather than the service's English. */
const HOST_KEYS = new Map<string, HostKey>([
  ['builtin:core', 'core'],
  ['user', 'personal'],
  ['shared:agents-skills', 'shared'],
]);

/** The order a plugin's contents are summarized in, matching the plugin page's groups. */
const COUNT_KINDS = ['command', 'skill', 'agent', 'mcp', 'memory'] as const;

/**
 * How a plugin reads in the list, its page and search: its name and description (translated for
 * the host plugins this app ships; an installed plugin's own text is shown as it is), a
 * plural-aware contents summary, and its source label.
 */
export function usePluginLabels() {
  const { t } = useTranslation('settings');
  return {
    name(plugin: Pick<PluginSummary, 'id' | 'name' | 'displayName'>): string {
      const key = HOST_KEYS.get(plugin.id);
      return key ? t(`extensions.plugins.host.${key}.name`) : plugin.displayName || plugin.name;
    },
    description(plugin: Pick<PluginSummary, 'id' | 'description'>): string {
      const key = HOST_KEYS.get(plugin.id);
      return key ? t(`extensions.plugins.host.${key}.description`) : plugin.description;
    },
    /**
     * "2 commands · 3 skills · Memory"; empty kinds are left out. Memory is one store, so it is
     * named rather than counted.
     */
    contents(counts: PluginSummary['counts']): string {
      const parts = COUNT_KINDS.flatMap((kind) => {
        if (!counts[kind]) return [];
        if (kind === 'memory') return [t('extensions.plugins.kinds.memory')];
        return [t(`extensions.plugins.count.${kind}`, { count: counts[kind] })];
      });
      return parts.length ? parts.join(' · ') : t('extensions.plugins.noContents');
    },
    source(badge: PluginSourceBadge): string {
      return t(`extensions.plugins.source.${badge}`);
    },
  };
}
