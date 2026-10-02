import { useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MemoryEntry, MemorySnapshot } from '../../client/agent/bridge';
import { MemoryDeleteDialog } from '../memory/memory-delete-dialog';
import { useMemoryWrites } from '../memory/memory-writes';
import { MemoryList } from '../memory/memory-list';
import { useOpenSettingsMemory } from '../settings/settings-navigation';

/**
 * Personal's saved memories. Memory has one authority, managed in the Memory section, which also
 * owns the learning switch; this tab lists the same entries (`useMemorySnapshot`, read by the
 * tabs): a row opens its editor in the Memory section, as command rows open the Commands section,
 * and More deletes it here after the same confirmation.
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
  const openEntry = useOpenSettingsMemory();
  const [deleting, setDeleting] = useState<MemoryEntry | null>(null);
  // Only the entries being deleted wait; the other rows stay usable. The row leaving the list is
  // the feedback; a failure shows its toast.
  const writes = useMemoryWrites();
  const title = t('extensions.plugins.kinds.memory');
  return (
    <section className="plugin-memory" aria-label={title}>
      {showTitle ? <h3 className="settings-section-title">{title}</h3> : null}
      {snapshot ? (
        snapshot.error && !snapshot.entries.length ? (
          <p role="alert" className="settings-inline-error">
            <CircleAlert aria-hidden />
            {snapshot.error}
          </p>
        ) : (
          <MemoryList
            entries={snapshot.entries}
            query=""
            busyIds={writes.savingIds}
            onClearSearch={() => undefined}
            onEdit={(entry) => openEntry(entry.id)}
            onDelete={setDeleting}
          />
        )
      ) : (
        <output className="settings-loading">{t('extensions.listLoading')}</output>
      )}
      <MemoryDeleteDialog
        entry={deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={(entry) => void writes.update(entry, '').catch(() => {})}
      />
    </section>
  );
}
