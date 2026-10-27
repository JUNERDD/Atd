import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@atd/ui/components/tabs';
import { HISTORY_FILTERS, type HistoryFilter } from './history-view';

/**
 * The tabs under the history's search that narrow the list to one condition; `children` are the
 * list, the one panel every tab shows.
 */
export function HistoryFilterTabs({
  filter,
  onChange,
  children,
}: {
  filter: HistoryFilter;
  onChange: (filter: HistoryFilter) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation('tasks');
  return (
    <Tabs
      value={filter}
      onValueChange={(value) => {
        const chosen = HISTORY_FILTERS.find((item) => item === value);
        if (chosen) onChange(chosen);
      }}
      className="min-h-0 flex-1 gap-3"
    >
      {/* Scrolls sideways when the tabs outgrow a narrow panel; `overflow-y-hidden` keeps each
          trigger's hidden underline from giving the strip a vertical scrollbar. */}
      <TabsList
        aria-label={t('history.filter.label')}
        className="scrollbar-none max-w-full shrink-0 justify-start overflow-x-auto overflow-y-hidden"
      >
        {HISTORY_FILTERS.map((item) => (
          <TabsTrigger key={item} value={item} className="flex-none px-2.5">
            {t(`history.filter.${item}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={filter} className="flex min-h-0 flex-col">
        {children}
      </TabsContent>
    </Tabs>
  );
}
