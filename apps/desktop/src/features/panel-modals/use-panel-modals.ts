import { useCallback, useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { readPersistedRecord, usePersistRecord } from '../../lib/persisted-record';
import { onWindowVisible } from '../../window-state';
import type { PanelView } from '../agent/use-task-panel';
import {
  PANEL_MODAL_STORAGE_PREFIX,
  PanelModalStateSchema,
  evaluateModalResolved,
  isPanelModalStateEmpty,
  restorePanelModalState,
  selectEligiblePanelModals,
  selectReopenablePanelModals,
  withClosedModalState,
  withDismissedAllModalStates,
  withModalImpression,
  withReconciledModalCompletions,
  type PanelModalDefinition,
  type PanelModalEnvironment,
  type PanelModalState,
} from './panel-modal-rules';
import {
  pickInitialReopenIndex,
  promoteUnresolvedEntries,
  removeSessionEntry,
  type ActiveModalSession,
} from './panel-modal-session';

const RESOLVED_CLOSE_DELAY_MS = 450;

const READ_STATE_OPTIONS = {
  isEmpty: isPanelModalStateEmpty,
  restore: restorePanelModalState,
};

const PERSIST_STATE_OPTIONS = {
  isEmpty: isPanelModalStateEmpty,
};

export interface ActivePanelModalItem {
  definition: PanelModalDefinition;
  sawUnresolved: boolean;
  resolved: boolean;
}

function readWindowVisible(): boolean {
  return (
    document.documentElement.dataset.windowVisible !== 'false' &&
    document.visibilityState !== 'hidden'
  );
}

function readEnvironment(windowVisible: boolean, now: number): PanelModalEnvironment {
  return {
    platform: window.desktop?.platform ?? 'web',
    hasDesktopBridge: window.desktop !== undefined,
    windowVisible,
    now,
  };
}

/**
 * Evaluates registered main-panel modals against live settings, panel view, persisted state, real
 * window visibility, and the generic macOS menu reopen trigger. Supports multiple simultaneous
 * eligible modals inside a swipeable deck plus independent per-modal dismissal and completion.
 */
export function usePanelModals(
  definitions: readonly PanelModalDefinition[],
  snapshot: SettingsSnapshot | null,
  view: PanelView,
  ready = true,
) {
  const reducedMotion = useReducedMotion() ?? false;
  const [windowVisible, setWindowVisible] = useState(readWindowVisible);
  const [evaluatedAt, setEvaluatedAt] = useState(() => Date.now());
  const [states, setStates] = useState<Record<string, PanelModalState>>(() =>
    readPersistedRecord(PANEL_MODAL_STORAGE_PREFIX, PanelModalStateSchema, READ_STATE_OPTIONS),
  );
  const [session, setSession] = useState<ActiveModalSession | null>(null);
  const [lastSessionKey, setLastSessionKey] = useState(0);
  const [pendingManualOpen, setPendingManualOpen] = useState(false);

  usePersistRecord(PANEL_MODAL_STORAGE_PREFIX, states, PERSIST_STATE_OPTIONS);

  useEffect(() => {
    const syncVisibility = () => {
      setWindowVisible(readWindowVisible());
      setEvaluatedAt(Date.now());
    };
    const unlistenVisible = onWindowVisible(syncVisibility);
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      unlistenVisible();
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const reopenable = selectReopenablePanelModals(definitions, snapshot, view, states, {
      platform: window.desktop?.platform ?? 'web',
      hasDesktopBridge: window.desktop !== undefined,
      windowVisible,
      now: evaluatedAt,
    });
    void window.desktop?.setPanelModalsAvailable?.(reopenable.length > 0).catch(() => undefined);
  }, [definitions, evaluatedAt, snapshot, states, view, windowVisible]);

  useEffect(() => {
    return window.desktop?.onPanelModalOpen?.(() => {
      setEvaluatedAt(Date.now());
      setPendingManualOpen(true);
    });
  }, []);

  const env = readEnvironment(windowVisible, evaluatedAt);
  const reopenableTarget =
    ready && snapshot && pendingManualOpen
      ? selectReopenablePanelModals(definitions, snapshot, view, states, env)
      : [];
  const autoCandidates =
    !pendingManualOpen && ready && snapshot && session === null && windowVisible
      ? selectEligiblePanelModals(definitions, snapshot, view, states, env)
      : [];

  let nextSession = session;
  if (pendingManualOpen && ready && snapshot) {
    setPendingManualOpen(false);
    if (reopenableTarget.length > 0) {
      const initialIndex = pickInitialReopenIndex(reopenableTarget, snapshot, view, states, env);
      const initialDef = reopenableTarget[initialIndex] ?? reopenableTarget[0];
      nextSession = {
        key: lastSessionKey + 1,
        entries: reopenableTarget.map((def) => ({
          id: def.id,
          sawUnresolved: !evaluateModalResolved(def, snapshot, view, states, env),
        })),
        manual: true,
        initialIndex,
        viewedIds: initialDef ? [initialDef.id] : [],
      };
    }
  } else if (autoCandidates.length > 0) {
    const initialAuto = autoCandidates[0];
    nextSession = {
      key: lastSessionKey + 1,
      entries: autoCandidates.map((def) => ({
        id: def.id,
        sawUnresolved: !evaluateModalResolved(def, snapshot, view, states, env),
      })),
      manual: false,
      initialIndex: 0,
      viewedIds: initialAuto ? [initialAuto.id] : [],
    };
  }

  let nextStates = states;
  if (nextSession && nextSession !== session) {
    setSession(nextSession);
    setLastSessionKey(nextSession.key);
    const initialEntry = nextSession.entries[nextSession.initialIndex] ?? nextSession.entries[0];
    if (initialEntry) {
      const updated = withModalImpression(
        nextStates,
        initialEntry.id,
        nextSession.manual,
        initialEntry.sawUnresolved,
        evaluatedAt,
      );
      if (updated) nextStates = updated;
    }
  }

  const activeIds = new Set((nextSession?.entries ?? []).map((entry) => entry.id));
  if (ready && snapshot) {
    const reconciled = withReconciledModalCompletions(
      definitions,
      nextStates,
      snapshot,
      view,
      env,
      activeIds,
    );
    if (reconciled) nextStates = reconciled;
  }

  if (nextStates !== states) {
    setStates(nextStates);
  }

  const byId = useMemo(() => new Map(definitions.map((def) => [def.id, def])), [definitions]);
  const promotedEntries = nextSession
    ? promoteUnresolvedEntries(nextSession.entries, byId, ready, snapshot, view, nextStates, env)
    : null;

  if (nextSession && promotedEntries) {
    nextSession = { ...nextSession, entries: promotedEntries };
    setSession(nextSession);
  }

  const activeItems: ActivePanelModalItem[] =
    ready && snapshot && nextSession
      ? nextSession.entries.flatMap((entry) => {
          const definition = byId.get(entry.id);
          if (!definition) return [];
          return [
            {
              definition,
              sawUnresolved: entry.sawUnresolved,
              resolved: evaluateModalResolved(definition, snapshot, view, nextStates, env),
            },
          ];
        })
      : [];

  const markSlideViewed = useCallback(
    (index: number) => {
      if (!session) return;
      const entry = session.entries[index];
      if (!entry || session.viewedIds.includes(entry.id)) return;
      const now = Date.now();
      setSession((prev) =>
        prev && !prev.viewedIds.includes(entry.id)
          ? { ...prev, viewedIds: [...prev.viewedIds, entry.id] }
          : prev,
      );
      setStates(
        (prev) =>
          withModalImpression(prev, entry.id, session.manual, entry.sawUnresolved, now) ?? prev,
      );
    },
    [session],
  );

  const dismissSlide = useCallback(
    (id: string) => {
      const definition = byId.get(id);
      if (!definition) return;
      const now = Date.now();
      const manual = session?.manual ?? false;
      setStates((prev) => withClosedModalState(prev, definition, 'dismissed', manual, now));
      setSession((prev) => removeSessionEntry(prev, id));
    },
    [byId, session],
  );

  const completeSlide = useCallback(
    (id: string) => {
      const definition = byId.get(id);
      if (!definition) return;
      const now = Date.now();
      const manual = session?.manual ?? false;
      setStates((prev) => withClosedModalState(prev, definition, 'completed', manual, now));
      setSession((prev) => removeSessionEntry(prev, id));
    },
    [byId, session],
  );

  const dismissAll = useCallback(() => {
    if (!session) return;
    const now = Date.now();
    const ids = session.entries.map((entry) => entry.id);
    const manual = session.manual;
    const currentEnv = readEnvironment(windowVisible, now);
    setStates((prev) =>
      withDismissedAllModalStates(prev, ids, byId, snapshot, view, currentEnv, manual),
    );
    setSession(null);
  }, [byId, session, snapshot, view, windowVisible]);

  // Auto-complete any active slide that transitions from unresolved to resolved while open.
  const autoResolvingIdsKey = activeItems
    .filter((item) => Boolean(item.definition.resolved) && item.sawUnresolved && item.resolved)
    .map((item) => item.definition.id)
    .join(',');
  useEffect(() => {
    if (!autoResolvingIdsKey) return;
    const ids = autoResolvingIdsKey.split(',');
    const delay = reducedMotion ? 0 : RESOLVED_CLOSE_DELAY_MS;
    const timer = window.setTimeout(() => {
      for (const id of ids) completeSlide(id);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [autoResolvingIdsKey, completeSlide, reducedMotion]);

  return {
    isOpen: ready && snapshot !== null && activeItems.length > 0,
    sessionKey: nextSession?.key ?? 0,
    initialIndex: nextSession?.initialIndex ?? 0,
    activeItems,
    snapshot,
    markSlideViewed,
    dismissSlide,
    completeSlide,
    dismissAll,
  };
}
