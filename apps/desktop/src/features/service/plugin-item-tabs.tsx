import { useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ai/ui/components/tabs';
import { PluginItemGroups, type PluginGroupKind } from './plugin-item-groups';
import { useMemorySnapshot } from '../memory/use-memory-snapshot';
import { PluginMemoryGroup } from './plugin-memory-group';

/** A plugin page's tabs: the item kinds in page order, then Personal's memory. */
type PluginKindTab = PluginGroupKind | 'memory';

type GroupProps = Omit<ComponentProps<typeof PluginItemGroups>, 'only' | 'titlePrefix'>;

/**
 * What one plugin contributes, one tab per kind it has: Commands, Skills, Subagents, MCP servers,
 * and Memory for Personal. Each tab names its kind and count (Memory's counts saved memories once
 * they are read), so its group drops its own title.
 * The first tab opens by default; when the open kind empties (its last item left the plugin), the
 * first remaining one shows instead.
 */
export function PluginItemTabs({
  memory,
  ...groups
}: GroupProps & {
  /** The plugin is Personal and holds the memory item: it gets the Memory tab. */
  memory: boolean;
}) {
  const { t } = useTranslation('settings');
  const { items } = groups;
  // Only Personal reads its memories; other plugins have no Memory tab.
  const { snapshot, setSnapshot } = useMemorySnapshot(memory);
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
      {/* Scrolls sideways when the tabs outgrow a narrow page. `overflow-x` alone makes the y axis
          scroll too, and each trigger's hidden underline (`::after`, 5px below it) would then
          give the list a vertical scrollbar; the focus ring stays within the list's padding. */}
      <TabsList
        aria-label={t('extensions.plugins.page.kindsLabel')}
        className="max-w-full justify-start overflow-x-auto overflow-y-hidden"
      >
        {tabs.map(([kind, count]) => (
          <TabsTrigger key={kind} value={kind} className="flex-none px-2.5">
            {t(`extensions.plugins.kinds.${kind}`)}
            {kind === 'memory' && !snapshot ? null : (
              <span className="text-muted-foreground tabular-nums">
                {kind === 'memory' ? snapshot?.entries.length : count}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map(([kind]) => (
        <TabsContent key={kind} value={kind} className="plugin-item-tab">
          {kind === 'memory' ? (
            <PluginMemoryGroup snapshot={snapshot} onSnapshot={setSnapshot} showTitle={false} />
          ) : (
            <PluginItemGroups {...groups} only={kind} />
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}
