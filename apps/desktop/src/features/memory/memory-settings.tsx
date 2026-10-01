import { useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { useCompositionQuery } from '@ai/ui/lib/ime';
import { ItemGroup } from '@ai/ui/components/item';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import type { MemoryEntry } from '../../client/agent/bridge';
import { FieldHint } from '../../components/field-hint';
import { SettingsHeading } from '../settings/settings-heading';
import { SettingsSearchField } from '../settings/settings-search-field';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { agentApi } from '../agent/use-agent';
import { showErrorToast, showToast } from '../../components/toast-store';
import { MemoryCreateButton } from './memory-create-button';
import { MemoryDeleteDialog } from './memory-delete-dialog';
import { MemoryEditor } from './memory-editor';
import { MemoryList } from './memory-list';
import { useMemorySnapshot } from './use-memory-snapshot';
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
  const { snapshot, setSnapshot } = useMemorySnapshot();
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
  // Only the controls in flight wait: the learning switch, or each entry being saved.
  const [pausing, setPausing] = useState(false);
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  function track(id: string, busy: boolean) {
    setSaving((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  const searchInput = useRef<HTMLInputElement>(null);
  useSettingsSectionExit(() => search.change(''));
  // The switch flipping is the feedback; only a failure needs a message.
  async function pause(paused: boolean) {
    setPausing(true);
    try {
      setSnapshot(await agentApi().pauseMemory(paused));
    } catch (error) {
      showErrorToast(error);
    }
    setPausing(false);
  }
  /**
   * Saves `entry` with new content; empty content deletes it. Either way the editor closes, and
   * only then is a toast needed: from the list, the row changing in place is the feedback.
   */
  async function update(entry: MemoryEntry, next: string) {
    const from = route;
    track(entry.id, true);
    const feedback = next ? t('memory.feedback.updated') : t('memory.feedback.deleted');
    try {
      setSnapshot(await agentApi().updateMemory(entry, next));
      history.leave(from);
      if (from.page === 'edit') showToast({ kind: 'info', text: feedback });
    } catch (error) {
      showErrorToast(error);
    } finally {
      track(entry.id, false);
    }
  }
  const feedback = snapshot?.error ? (
    <>
      <p role="alert" className="settings-inline-error">
        <CircleAlert aria-hidden />
        {snapshot.error}
      </p>
      <Button
        variant="outline"
        className="mt-3"
        onClick={() => {
          void agentApi()
            .memory()
            .then(setSnapshot)
            .catch((error) => showErrorToast(error));
        }}
      >
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
          busy={saving.has(editing.id)}
          feedback={feedback}
          onSave={(content) => void update(editing, content)}
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
            className="mt-4 flex-1"
            viewportClassName="[&>div]:flex! [&>div]:flex-col [&>div]:min-h-full"
            gutter="stable"
            scrollShadow
          >
            <div className="memory-list">
              {/* A setting, not a memory: a switch row, unlike the list rows below it. The
                  switch is its own undo, so pausing asks no confirmation; the description says
                  what turning it off does. */}
              <ItemGroup className="memory-learning">
                <SettingsSwitchRow
                  id="memory-learning"
                  title={t('memory.learning.label')}
                  description={t('memory.learning.description')}
                  checked={snapshot ? !snapshot.paused : false}
                  pending={pausing}
                  disabled={!snapshot || Boolean(snapshot.error)}
                  onCheckedChange={(checked) => void pause(!checked)}
                />
              </ItemGroup>
              {snapshot ? (
                snapshot.error && !snapshot.entries.length ? null : (
                  <MemoryList
                    entries={snapshot.entries}
                    query={search.query}
                    busyIds={saving}
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
        </>
      )}
      <MemoryDeleteDialog
        entry={deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={(entry) => void update(entry, '')}
      />
    </section>
  );
}
