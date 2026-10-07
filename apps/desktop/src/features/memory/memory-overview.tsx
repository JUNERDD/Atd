import type { ReactNode, Ref } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MemoryProblem, MemoryProposal, MemoryUnit } from '@atd/agent-contracts';
import { Alert, AlertDescription, AlertTitle } from '@atd/ui/components/alert';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import type { useCompositionQuery } from '@atd/ui/lib/ime';
import type { MemorySnapshot } from '../../client/agent/bridge';
import { FieldHint } from '../../components/field-hint';
import { SettingsHeading } from '../settings/settings-heading';
import { SettingsSearchField } from '../settings/settings-search-field';
import { MemoryAddMenu } from './memory-add-menu';
import { MemoryLearningFooter } from './memory-learning-footer';
import { MemoryList } from './memory-list';
import { MemorySuggestions } from './memory-suggestions';
import type { useMemoryWrites } from './memory-writes';

/** Unit files the service could not read; they stay out of runs until fixed or removed. */
function MemoryProblems({ problems }: { problems: readonly MemoryProblem[] }) {
  const { t } = useTranslation('memory');
  if (!problems.length) return null;
  return (
    <Alert>
      <CircleAlert />
      <AlertTitle>{t('memory.problems.title')}</AlertTitle>
      <AlertDescription>
        <p>{t('memory.problems.description')}</p>
        <ul className="flex flex-col gap-1">
          {problems.map((problem) => (
            <li key={problem.path} className="font-mono text-xs break-all">
              {`${problem.path}: ${problem.message}`}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

/**
 * The Memory section's overview: the heading with the search and the Add menu, then, scrolling
 * under it, unreadable files, the learner's suggestions and the memories, with the learning
 * settings in the floating footer.
 */
export function MemoryOverview({
  snapshot,
  search,
  searchRef,
  writes,
  feedback,
  onClearSearch,
  onNew,
  onOpen,
  onDelete,
  onAccept,
}: {
  /** Null until the first read answers. */
  snapshot: MemorySnapshot | null;
  search: ReturnType<typeof useCompositionQuery>;
  searchRef: Ref<HTMLInputElement>;
  writes: ReturnType<typeof useMemoryWrites>;
  /** The load failure and its Reload, if any. */
  feedback: ReactNode;
  onClearSearch: () => void;
  onNew: () => void;
  onOpen: (unit: MemoryUnit) => void;
  onDelete: (unit: MemoryUnit) => void;
  onAccept: (proposal: MemoryProposal) => void;
}) {
  const { t } = useTranslation('memory');
  const unavailable = !snapshot || Boolean(snapshot.error);
  return (
    <>
      <SettingsHeading
        title={t('memory.title')}
        titleHint={
          <FieldHint
            text={t('memory.feedback.storageNote')}
            side="bottom"
            icon={<CircleAlert className="size-4" />}
          />
        }
        description={t('memory.description')}
      >
        <SettingsSearchField
          search={search}
          ref={searchRef}
          aria-label={t('memory.searchLabel')}
          placeholder={t('memory.searchPlaceholder')}
          disabled={!snapshot?.units.length}
        />
        <MemoryAddMenu paused={Boolean(snapshot?.paused)} unavailable={unavailable} onNew={onNew} />
      </SettingsHeading>
      {/* The panel owns the scrollbar; the heading and search stay put above it. */}
      <ScrollArea
        className="memory-scroll settings-page-scroll"
        viewportClassName="overlay-footer-fade [&>div]:flex! [&>div]:flex-col [&>div]:min-h-full"
        gutter="none"
        scrollShadow
      >
        <div className="memory-list">
          {snapshot ? (
            <>
              <MemoryProblems problems={snapshot.problems} />
              <MemorySuggestions
                proposals={snapshot.proposals}
                units={snapshot.units}
                busyIds={writes.proposalBusyIds}
                onAccept={onAccept}
                onDismiss={writes.dismiss}
              />
              {snapshot.error && !snapshot.units.length ? null : (
                <MemoryList
                  units={snapshot.units}
                  query={search.query}
                  busyIds={writes.busyIds}
                  onClearSearch={onClearSearch}
                  onOpen={onOpen}
                  // The switch flipping is the feedback; only a failure needs a message.
                  onToggle={writes.toggle}
                  onDelete={onDelete}
                />
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('memory.list.loading')}</p>
          )}
          {feedback}
        </div>
      </ScrollArea>
      <MemoryLearningFooter
        learning={snapshot ? !snapshot.paused : false}
        askFirst={snapshot?.askFirst ?? false}
        pending={writes.settingsPending}
        disabled={unavailable}
        // The switch flipping is the feedback; only a failure needs a message.
        onChange={writes.saveSettings}
      />
    </>
  );
}
