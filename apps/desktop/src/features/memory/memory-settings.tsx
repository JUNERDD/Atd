import { useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  MemoryCreateRequest,
  MemoryProposal,
  MemorySaveRequest,
  MemoryUnit,
} from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { useCompositionQuery } from '@atd/ui/lib/ime';
import { showToast } from '../../components/toast-store';
import { USER_PLUGIN_ID } from '../service/plugin-rows';
import { useOpenSettingsExtension, useSettingsSectionExit } from '../settings/settings-navigation';
import { useSettingsPageHistory } from '../settings/use-settings-page-history';
import { MemoryDeleteDialog } from './memory-delete-dialog';
import { MemoryOverview } from './memory-overview';
import { MemoryPage } from './memory-page';
import { useMemoryWrites } from './memory-writes';
import { reloadMemory, useMemorySnapshot } from './use-memory-snapshot';

/**
 * A page of the Memory section: the overview, one unit's page (`nonce` marks each deep link, so
 * every link opens afresh), or the New memory page (`key` renews it on each opening).
 */
type MemoryRoute =
  | { page: 'list' }
  | { page: 'unit'; id: string; nonce?: number }
  | { page: 'new'; key: number };
const LIST: MemoryRoute = { page: 'list' };

/**
 * The Memory section. `activeEntry` is a link to one unit's page (Personal's Memory tab links
 * here); each link carries a new nonce and opens as a page of the section's history. A page whose
 * unit is gone falls back to the overview, unless the unit was deleted elsewhere while the page
 * held unsaved edits: then the page stays to save them as a new memory.
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
  const openExtension = useOpenSettingsExtension();
  const units = snapshot?.units ?? [];
  const history = useSettingsPageHistory<MemoryRoute>(
    LIST,
    (route) => route.page !== 'unit' || !snapshot || units.some(({ id }) => id === route.id),
  );
  const { route } = history;
  const [linked, setLinked] = useState(0);
  if (activeEntry && activeEntry.nonce !== linked) {
    setLinked(activeEntry.nonce);
    history.open({ page: 'unit', id: activeEntry.id, nonce: activeEntry.nonce });
  }
  const [deleting, setDeleting] = useState<MemoryUnit | null>(null);
  /**
   * The open page's unit as last read, with the page it was read for: a failed read or a delete
   * elsewhere keeps that page (and its edits) open, but a later opening starts from a fresh read.
   */
  const [held, setHeld] = useState<{ route: MemoryRoute; unit: MemoryUnit } | null>(null);
  /** The unit the open page is deleting: its going is that delete, not one made elsewhere. */
  const [removing, setRemoving] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useSettingsSectionExit(() => search.change(''));

  /**
   * Leaves the page `from` once its write succeeds and says so; `to` first swaps it for the page
   * Forward should reopen (a created unit's). A failure keeps the page, with its toast.
   */
  function finish<T>(
    write: Promise<T>,
    from: MemoryRoute,
    text: string,
    to?: (result: T) => MemoryRoute,
  ) {
    void write.then(
      (result) => {
        const next = to?.(result);
        if (next) history.replace(next, from);
        history.leave(next ?? from);
        showToast({ kind: 'info', text });
      },
      () => {},
    );
  }
  const create = (from: MemoryRoute, input: MemoryCreateRequest) =>
    finish(writes.create(input), from, t('memory.feedback.created'), ({ unit }) => unitRoute(unit));
  const save = (from: MemoryRoute, input: MemorySaveRequest) =>
    finish(writes.save(input), from, t('memory.feedback.updated'));
  /**
   * From the overview the row leaving is the feedback; a page closes and says so. A page's own
   * delete stays `removing` unless it fails.
   */
  function remove(unit: MemoryUnit) {
    if (route.page !== 'unit') {
      void writes.remove(unit).catch(() => {});
      return;
    }
    setRemoving(unit.id);
    const write = writes.remove(unit);
    void write.catch(() => setRemoving(null));
    finish(write, route, t('memory.feedback.deleted'));
  }
  /** A skill suggestion's skill opens on its Extensions page once the catalogs list it. */
  function accept(proposal: MemoryProposal) {
    void writes.accept(proposal).then(
      (skill) => {
        if (!skill) return;
        showToast({ kind: 'info', text: t('memory.suggestions.skillCreated', { name: skill }) });
        openExtension({ pluginId: USER_PLUGIN_ID, kind: 'skill', name: skill });
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
  const found = route.page === 'unit' ? units.find(({ id }) => id === route.id) : undefined;
  if (found && (held?.unit !== found || held?.route !== route)) setHeld({ route, unit: found });
  const unit = found ?? (held?.route === route ? held.unit : undefined);
  // A read answered without the page's unit. A link to an unknown unit falls back to the overview
  // at once. An open page decides for itself (`deleted`), since only it knows its edits; after its
  // own delete it is not told, and that delete leaves it once it lands.
  const gone = route.page === 'unit' && !found && Boolean(snapshot && !snapshot.error);
  if (gone && !unit) history.discard();
  const dialog = (
    <MemoryDeleteDialog unit={deleting} onCancel={() => setDeleting(null)} onConfirm={remove} />
  );
  if (route.page === 'unit' && !unit)
    return (
      <section className="memory-settings">
        {feedback ?? <output className="settings-loading">{t('memory.list.loading')}</output>}
      </section>
    );
  if (route.page !== 'list')
    return (
      <section className="memory-settings">
        <MemoryPage
          key={route.page === 'unit' ? `${route.id}-${route.nonce ?? ''}` : `new-${route.key}`}
          unit={unit ?? null}
          deleted={gone && unit?.id !== removing}
          takenNames={units.filter(({ id }) => id !== unit?.id).map(({ name }) => name)}
          busy={writes.creating || (unit !== undefined && writes.busyIds.has(unit.id))}
          feedback={feedback}
          onCreate={(input) => create(route, input)}
          onSave={(input) => save(route, input)}
          onReviewed={writes.markReviewed}
          onDelete={() => setDeleting(unit ?? null)}
          onDiscard={history.discard}
          onCancel={history.back}
        />
        {dialog}
      </section>
    );
  return (
    <section className="memory-settings">
      <MemoryOverview
        snapshot={snapshot}
        search={search}
        searchRef={searchInput}
        writes={writes}
        feedback={feedback}
        onClearSearch={() => {
          search.change('');
          searchInput.current?.focus();
        }}
        onNew={() => history.open({ page: 'new', key: Date.now() })}
        onOpen={(opened) => history.open(unitRoute(opened))}
        onDelete={setDeleting}
        onAccept={accept}
      />
      {dialog}
    </section>
  );
}

const unitRoute = (unit: MemoryUnit): MemoryRoute => ({ page: 'unit', id: unit.id });
