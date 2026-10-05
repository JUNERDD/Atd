import { useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MemoryUnit } from '@atd/agent-contracts';
import type { MemorySnapshot } from '../../client/agent/bridge';
import { MemoryDeleteDialog } from '../memory/memory-delete-dialog';
import { useMemoryWrites } from '../memory/memory-writes';
import { MemoryList } from '../memory/memory-list';
import { useOpenSettingsMemory } from '../settings/settings-navigation';

/**
 * Personal's memories. Memory has one authority, managed in the Memory section, which also owns
 * the learning settings and the suggestions; this tab lists the same units (`useMemorySnapshot`,
 * read by the tabs) as the same cards: a card opens its page in the Memory section, as command
 * rows open the Commands section, its switch turns it on or off here, and More deletes it here
 * after the same confirmation.
 */
export function PluginMemoryGroup({
  snapshot,
  showTitle = true,
}: {
  /** The saved memories; null until they are read. */
  snapshot: MemorySnapshot | null;
  /** False when a tab names the kind; the section keeps its name for accessibility. */
  showTitle?: boolean;
}) {
  const { t } = useTranslation('settings');
  const openUnit = useOpenSettingsMemory();
  const [deleting, setDeleting] = useState<MemoryUnit | null>(null);
  // Only the units being turned on or off or deleted wait; the other cards stay usable. The switch
  // flipping or the card leaving the list is the feedback; a failure shows its toast.
  const writes = useMemoryWrites();
  const title = t('extensions.plugins.kinds.memory');
  return (
    <section className="plugin-memory" aria-label={title}>
      {showTitle ? <h3 className="settings-section-title">{title}</h3> : null}
      {snapshot ? (
        snapshot.error && !snapshot.units.length ? (
          <p role="alert" className="settings-inline-error">
            <CircleAlert aria-hidden />
            {snapshot.error}
          </p>
        ) : (
          <MemoryList
            units={snapshot.units}
            query=""
            busyIds={writes.busyIds}
            onClearSearch={() => undefined}
            onOpen={(unit) => openUnit(unit.id)}
            onToggle={writes.toggle}
            onDelete={setDeleting}
          />
        )
      ) : (
        <output className="settings-loading">{t('extensions.listLoading')}</output>
      )}
      <MemoryDeleteDialog
        unit={deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={(unit) => void writes.remove(unit).catch(() => {})}
      />
    </section>
  );
}
