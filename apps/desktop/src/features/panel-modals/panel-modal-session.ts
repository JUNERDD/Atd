import type { SettingsSnapshot } from '../../client/settings-contract';
import type { PanelView } from '../agent/use-task-panel';
import {
  buildPanelModalContext,
  evaluateModalResolved,
  type PanelModalDefinition,
  type PanelModalEnvironment,
  type PanelModalState,
} from './panel-modal-rules';

export interface ActiveModalEntry {
  id: string;
  sawUnresolved: boolean;
}

export interface ActiveModalSession {
  key: number;
  entries: ActiveModalEntry[];
  manual: boolean;
  initialIndex: number;
  viewedIds: string[];
}

export function pickInitialReopenIndex(
  reopenable: readonly PanelModalDefinition[],
  snapshot: SettingsSnapshot,
  view: PanelView,
  states: Record<string, PanelModalState>,
  env: PanelModalEnvironment,
): number {
  const firstPendingAndEligible = reopenable.findIndex(
    (def) =>
      !evaluateModalResolved(def, snapshot, view, states, env) &&
      def.rule(buildPanelModalContext(def, snapshot, view, states, env)),
  );
  if (firstPendingAndEligible >= 0) return firstPendingAndEligible;
  const firstUnresolved = reopenable.findIndex(
    (def) => !evaluateModalResolved(def, snapshot, view, states, env),
  );
  return firstUnresolved >= 0 ? firstUnresolved : 0;
}

export function removeSessionEntry(
  session: ActiveModalSession | null,
  id: string,
): ActiveModalSession | null {
  if (!session) return null;
  const remaining = session.entries.filter((entry) => entry.id !== id);
  return remaining.length > 0 ? { ...session, entries: remaining } : null;
}

export function promoteUnresolvedEntries(
  entries: ActiveModalEntry[],
  byId: ReadonlyMap<string, PanelModalDefinition>,
  ready: boolean,
  snapshot: SettingsSnapshot | null,
  view: PanelView,
  states: Record<string, PanelModalState>,
  env: PanelModalEnvironment,
): ActiveModalEntry[] | null {
  if (!ready || !snapshot) return null;
  let changed = false;
  const next: ActiveModalEntry[] = [];
  for (const entry of entries) {
    const def = byId.get(entry.id);
    if (
      !entry.sawUnresolved &&
      def?.resolved &&
      !evaluateModalResolved(def, snapshot, view, states, env)
    ) {
      changed = true;
      next.push({ ...entry, sawUnresolved: true });
    } else {
      next.push(entry);
    }
  }
  return changed ? next : null;
}
