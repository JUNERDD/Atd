import { useDeferredValue } from 'react';
import { Brain, SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MemoryUnit } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@atd/ui/components/empty';
import { matchFields } from '@atd/ui/lib/fuzzy-match';
import { ListCardGrid } from '../../components/list-card';
import { useRevealMore } from '../../components/use-reveal-more';
import { MemoryCard } from './memory-card';

/** Cards mounted at first, and added each time the end of the grid nears the scroll viewport. */
const CARD_BATCH = 60;

/**
 * Memories as cards (`MemoryCard`) in a grid of as many columns as the width holds, like the other
 * overviews of Settings, in Settings order, shared by the Memory section and Personal's Memory
 * tab. The search matches the name, description and content and marks what it matched; with no
 * memories shown it says why (nothing saved, or no match, which offers to clear the search).
 * Matching reads every body, so it follows a deferred copy of the query to keep typing responsive,
 * and the cards mount a batch at a time.
 */
export function MemoryList({
  units,
  query,
  busyIds,
  onClearSearch,
  onOpen,
  onToggle,
  onDelete,
}: {
  units: readonly MemoryUnit[];
  query: string;
  /**
   * The units being saved, turned on or off, or deleted, whose cards keep focus but ignore input;
   * the other cards stay usable.
   */
  busyIds: ReadonlySet<string>;
  onClearSearch: () => void;
  onOpen: (unit: MemoryUnit) => void;
  onToggle: (unit: MemoryUnit, enabled: boolean) => void;
  onDelete: (unit: MemoryUnit) => void;
}) {
  const { t } = useTranslation('memory');
  // Everything below, marks included, follows this one query so the marks fit the cards filtered.
  const searched = useDeferredValue(query);
  const shown = units.flatMap((unit) => {
    const { description, name, body } = unit;
    const match = matchFields(searched, { description, name, body });
    return match || !searched.trim() ? [{ unit, match }] : [];
  });
  const { count, sentinel } = useRevealMore(shown.length, CARD_BATCH, searched);
  if (!shown.length) {
    const searching = units.length > 0;
    return (
      <div className="settings-extension-empty">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">{searching ? <SearchX /> : <Brain />}</EmptyMedia>
            <EmptyTitle>
              {searching
                ? t('memory.list.noMatches', { query: searched.trim() })
                : t('memory.list.empty')}
            </EmptyTitle>
          </EmptyHeader>
          {searching && (
            <EmptyContent>
              <Button variant="outline" onClick={onClearSearch}>
                {t('memory.list.clearSearch')}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      </div>
    );
  }
  return (
    <div>
      <ListCardGrid>
        {shown.slice(0, count).map(({ unit, match }) => (
          <MemoryCard
            key={unit.id}
            unit={unit}
            match={match}
            busy={busyIds.has(unit.id)}
            onOpen={onOpen}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        ))}
      </ListCardGrid>
      {count < shown.length && <div ref={sentinel} aria-hidden className="h-px" />}
    </div>
  );
}
