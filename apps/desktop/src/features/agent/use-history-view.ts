import { useState } from 'react';
import { readPersistedRecord, usePersistRecord } from '../../lib/persisted-record';
import { DEFAULT_HISTORY_VIEW, HistoryViewSchema, type HistoryView } from './history-view';

const PREFIX = 'history.';
const OPTIONS = { isEmpty: () => false };

/** The sort and group the history list was left with; they outlive the page. */
export function useHistoryView(): [HistoryView, (view: HistoryView) => void] {
  const [saved, setSaved] = useState(() => readPersistedRecord(PREFIX, HistoryViewSchema, OPTIONS));
  usePersistRecord(PREFIX, saved, OPTIONS);
  return [saved['view'] ?? DEFAULT_HISTORY_VIEW, (view) => setSaved({ view })];
}
