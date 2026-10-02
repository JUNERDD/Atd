import { useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { useCompositionQuery } from '@atd/ui/lib/ime';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import type { MemoryEntry } from '../../client/agent/bridge';
import { FieldHint } from '../../components/field-hint';
import { SettingsHeading } from '../settings/settings-heading';
import { SettingsSearchField } from '../settings/settings-search-field';
import { showToast } from '../../components/toast-store';
import { MemoryCreateButton } from './memory-create-button';
import { MemoryDeleteDialog } from './memory-delete-dialog';
import { MemoryEditor } from './memory-editor';
import { MemoryLearningFooter } from './memory-learning-footer';
import { MemoryList } from './memory-list';
import { useMemoryWrites } from './memory-writes';
import { reloadMemory, useMemorySnapshot } from './use-memory-snapshot';
import { useSettingsSectionExit } from '../settings/settings-navigation';
import { useSettingsPageHistory } from '../settings/use-settings-page-history';

/** A page of the Memory section: the list, or one entry's editor. */
type MemoryRoute = { page: 'list' } | { page: 'edit'; entry: MemoryEntry };
const LIST: MemoryRoute = { page: 'list' };

/**
 * The Memory section. `activeEntry` is a link to one entry's editor (Personal's Memory tab links
 * here); each link carries a new nonce and opens as a page of the section's history once the entry
 * is in the snapshot.
 */
export function MemorySettings({
  activeEntry,
}: {
  activeEntry?: { id: string; nonce: number } | null;
}) {
  const { t } = useTranslation('memory');
  const { snapshot } = useMemorySnapshot();
  const writes = useMemoryWrites();
  const search = useCompositionQuery();
  const history = useSettingsPageHistory<MemoryRoute>(
    LIST,
    (route) =>
      route.page === 'list' ||
      !snapshot ||
      snapshot.entries.some(({ id }) => id === route.entry.id),
  );
  const { route } = history;
  const [linked, setLinked] = useState(0);
  const linkedEntry = activeEntry && snapshot?.entries.find(({ id }) => id === activeEntry.id);
  if (activeEntry && linkedEntry && activeEntry.nonce !== linked) {
    setLinked(activeEntry.nonce);
    history.open({ page: 'edit', entry: linkedEntry });
  }
  // The entry as the latest snapshot has it; one removed meanwhile stays as the editor opened it.
  const editing =
    route.page === 'edit'
      ? (snapshot?.entries.find(({ id }) => id === route.entry.id) ?? route.entry)
      : null;
  const [deleting, setDeleting] = useState<MemoryEntry | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useSettingsSectionExit(() => search.change(''));
  /**
   * Saves `entry` with new content; empty content deletes it. Either way the editor closes, and
   * only then is a toast needed: from the list, the row changing in place is the feedback. A
   * failure keeps the page, with its toast.
   */
  function update(entry: MemoryEntry, next: string) {
    const from = route;
    const feedback = next ? t('memory.feedback.updated') : t('memory.feedback.deleted');
    void writes.update(entry, next).then(
      () => {
        history.leave(from);
        if (from.page === 'edit') showToast({ kind: 'info', text: feedback });
      },
      () => {},
    );
  }
  const feedback = snapshot?.error ? (
    <>
      <p role="alert" className="settings-inline-error">
        <CircleAlert aria-hidden />
        {snapshot.error}
      </p>
      <Button variant="outline" className="mt-3" onClick={reloadMemory}>
        {t('memory.feedback.reload')}
      </Button>
    </>
  ) : null;
  return (
    <section className="memory-settings">
      {editing ? (
        <MemoryEditor
          key={editing.id}
          entry={editing}
          busy={writes.savingIds.has(editing.id)}
          feedback={feedback}
          onSave={(content) => update(editing, content)}
          onDelete={() => setDeleting(editing)}
          onCancel={history.back}
        />
      ) : (
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
              ref={searchInput}
              aria-label={t('memory.searchLabel')}
              placeholder={t('memory.searchPlaceholder')}
              disabled={!snapshot?.entries.length}
            />
            <MemoryCreateButton
              paused={Boolean(snapshot?.paused)}
              unavailable={!snapshot || Boolean(snapshot.error)}
            />
          </SettingsHeading>
          {/* The panel owns the scrollbar; the heading and search stay put above it. */}
          <ScrollArea
            className="memory-scroll flex-1"
            viewportClassName="overlay-footer-fade [&>div]:flex! [&>div]:flex-col [&>div]:min-h-full"
            gutter="stable"
            scrollShadow
          >
            <div className="memory-list">
              {snapshot ? (
                snapshot.error && !snapshot.entries.length ? null : (
                  <MemoryList
                    entries={snapshot.entries}
                    query={search.query}
                    busyIds={writes.savingIds}
                    onClearSearch={() => {
                      search.change('');
                      searchInput.current?.focus();
                    }}
                    onEdit={(entry) => history.open({ page: 'edit', entry })}
                    onDelete={setDeleting}
                  />
                )
              ) : (
                <p className="text-sm text-muted-foreground">{t('memory.list.loading')}</p>
              )}
              {feedback}
            </div>
          </ScrollArea>
          <MemoryLearningFooter
            checked={snapshot ? !snapshot.paused : false}
            pending={writes.pausing}
            disabled={!snapshot || Boolean(snapshot.error)}
            // The switch flipping is the feedback; only a failure needs a message.
            onCheckedChange={(checked) => writes.pause(!checked)}
          />
        </>
      )}
      <MemoryDeleteDialog
        entry={deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={(entry) => update(entry, '')}
      />
    </section>
  );
}
