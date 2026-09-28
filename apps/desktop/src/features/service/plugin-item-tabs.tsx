import { useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ai/ui/components/tabs';
import { PluginItemGroups, type PluginGroupKind } from './plugin-item-groups';
import { PluginMemoryGroup } from './plugin-memory-group';

/** A plugin page's tabs: the item kinds in page order, then Personal's memory. */
type PluginKindTab = PluginGroupKind | 'memory';

type GroupProps = Omit<ComponentProps<typeof PluginItemGroups>, 'only' | 'titlePrefix'>;

/**
 * What one plugin contributes, one tab per kind it has: Commands, Skills, Subagents, MCP servers,
 * and Memory for Personal. Each tab names its kind and count, so its group drops its own title.
 * The first tab opens by default; when the open kind empties (its last item left the plugin), the
 * first remaining one shows instead.
 */
export function PluginItemTabs({
  memory,
  ...groups
}: GroupProps & {
  /** Personal's memory: the learning switch, which is the memory pause. */
  memory: ComponentProps<typeof PluginMemoryGroup> | null;
}) {
  const { t } = useTranslation('settings');
  const { items } = groups;
  const counts: [PluginKindTab, number][] = [
    ['command', items.commands.length],
    ['skill', items.skills.length],
    ['agent', items.agents.length],
    ['mcp', items.mcp.length],
    ['memory', memory ? 1 : 0],
  ];
  const tabs = counts.filter(([, count]) => count > 0);
  const [chosen, setChosen] = useState<PluginKindTab | null>(null);
  const first = tabs[0]?.[0];
  if (!first) return null;
  const active = tabs.some(([kind]) => kind === chosen) && chosen ? chosen : first;
  return (
    <Tabs
      value={active}
      onValueChange={(value) => {
        const tab = tabs.find(([kind]) => kind === value);
        if (tab) setChosen(tab[0]);
      }}
    >
      <TabsList
        aria-label={t('extensions.plugins.page.kindsLabel')}
        className="max-w-full justify-start overflow-x-auto"
      >
        {tabs.map(([kind, count]) => (
          <TabsTrigger key={kind} value={kind} className="flex-none px-2.5">
            {t(`extensions.plugins.kinds.${kind}`)}
            {kind === 'memory' ? null : (
              <span className="text-muted-foreground tabular-nums">{count}</span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map(([kind]) => (
        <TabsContent key={kind} value={kind} className="plugin-item-tab">
          {kind === 'memory' ? (
            memory ? (
              <PluginMemoryGroup {...memory} showTitle={false} />
            ) : null
          ) : (
            <PluginItemGroups {...groups} only={kind} />
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}
