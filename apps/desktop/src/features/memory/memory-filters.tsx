import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@atd/ui/components/tabs';
import { MEMORY_GROUPS, MEMORY_GROUP_LABEL_KEYS, type MemoryGroup } from './memory-groups';

/**
 * The Settings overview's memory group tabs, one selected at a time; `children` are the scrolling
 * list, the one panel every tab shares.
 */
export function MemoryFilters({
  value,
  counts,
  onChange,
  children,
}: {
  value: MemoryGroup;
  counts: Record<MemoryGroup, number> | null;
  onChange: (group: MemoryGroup) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation('memory');
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        const chosen = MEMORY_GROUPS.find((group) => group === next);
        if (chosen) onChange(chosen);
      }}
      className="min-h-0 min-w-0 flex-1 gap-4"
    >
      {/* Scrolls sideways when the tabs outgrow a narrow panel; `overflow-y-hidden` keeps each
          trigger's hidden underline from giving the list a vertical scrollbar. */}
      <TabsList
        aria-label={t('memory.groups.label')}
        className="scrollbar-none max-w-full shrink-0 justify-start overflow-x-auto overflow-y-hidden"
      >
        {MEMORY_GROUPS.map((group) => (
          <TabsTrigger
            key={group}
            value={group}
            className="flex-none px-2.5"
            aria-label={
              counts
                ? `${String(t(MEMORY_GROUP_LABEL_KEYS[group]))} (${String(counts[group])})`
                : undefined
            }
          >
            {t(MEMORY_GROUP_LABEL_KEYS[group])}
            {counts && <span className="text-muted-foreground tabular-nums">{counts[group]}</span>}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={value} className="flex min-h-0 min-w-0 flex-col">
        {children}
      </TabsContent>
    </Tabs>
  );
}
