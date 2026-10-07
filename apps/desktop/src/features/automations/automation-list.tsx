import { useTranslation } from 'react-i18next';
import { SearchX } from 'lucide-react';
import type { AutomationItem } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@atd/ui/components/empty';
import { ItemGroup } from '@atd/ui/components/item';
import { matchFields } from '@atd/ui/lib/fuzzy-match';
import { AutomationRow, type AutomationRowActions } from './automation-row';
import { triggerWords, type TriggerNames } from './automation-words';

/**
 * The saved automations by name, each with its trigger in words; the search matches and marks
 * the name and that sentence. Rows keep one anatomy and action order whatever their state.
 */
export function AutomationList({
  automations,
  query,
  pendingIds,
  paused,
  unavailable,
  names,
  onClearSearch,
  ...actions
}: {
  automations: readonly AutomationItem[];
  query: string;
  /** Automations whose switch is saving: their run and enable controls wait. */
  pendingIds: ReadonlySet<string>;
  /** The global pause is on: enabled rows say so instead of naming a next run. */
  paused: boolean;
  /** The saved automations could not be read: nothing can run. */
  unavailable: boolean;
  names: TriggerNames;
  onClearSearch: () => void;
} & AutomationRowActions) {
  const { t, i18n } = useTranslation('automations');
  const collator = new Intl.Collator(i18n.language, { numeric: true, sensitivity: 'base' });
  const rows = automations
    .map((item) => {
      const summary = triggerWords(item.automation.trigger, names, t, i18n.language);
      const match = matchFields(query, { name: item.automation.name, summary });
      return { item, summary, match };
    })
    .filter(({ match }) => match || !query.trim())
    .sort((a, b) => collator.compare(a.item.automation.name, b.item.automation.name));
  if (query.trim() && automations.length && !rows.length)
    return (
      <div className="settings-extension-empty">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>{t('list.noMatches', { query: query.trim() })}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={onClearSearch}>
              {t('list.clearSearch')}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  return (
    <ItemGroup aria-label={t('list.title')}>
      {rows.map(({ item, summary, match }) => (
        <AutomationRow
          key={item.automation.id}
          item={item}
          summary={summary}
          match={match}
          busy={pendingIds.has(item.automation.id)}
          paused={paused}
          unavailable={unavailable}
          {...actions}
        />
      ))}
    </ItemGroup>
  );
}
