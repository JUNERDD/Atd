import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, skipToken, useQuery, type QueryFunction } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { Value } from 'typebox/value';
import {
  AutomationTriggerSchema,
  type AutomationItem,
  type AutomationTrigger,
  type PreviewAutomationTriggerRequest,
} from '@atd/agent-contracts';
import { AutomationConflictError, type AutomationsBridge } from '../../client/automations-contract';
import { showErrorToast, showToast } from '../../components/toast-store';
import { failureWords, problemWords } from './automation-words';
import { messageOf } from '../../lib/errors';
import { queryClient } from '../../lib/query-client';
import { useServiceStatus } from '../service/use-service';

/** Query keys of the automations data; everything sits under `all`, so one invalidation reloads it. */
export const automationKeys = {
  all: ['automations'],
  list: ['automations', 'list'],
  runs: (id: string) => ['automations', 'runs', id],
  /** A trigger's preview by its JSON; chain previews depend on the list, so they reload with it. */
  preview: (trigger: string, automationId: string | null) => [
    'automations',
    'preview',
    trigger,
    automationId,
  ],
} as const;

/** How many next run times the editor shows (the tool's confirmation names three as well). */
const PREVIEW_COUNT = 3;
/** How long a trigger must hold still before it is previewed, so typing does not ask per key. */
const PREVIEW_DELAY_MS = 300;

let wired: { bridge: AutomationsBridge; stop: () => void } | null = null;

/**
 * The automations bridge, with the cache following its changes: an `automations` invalidation or
 * a reconnect reloads every automation query of this window. Wired once per bridge (tests install
 * one per case).
 */
export function automationsBridge(): AutomationsBridge {
  const bridge = window.desktop?.automations;
  if (!bridge) throw new Error('Open the desktop app to use automations.');
  if (wired?.bridge !== bridge) {
    wired?.stop();
    wired = {
      bridge,
      stop: bridge.onChange(
        () => void queryClient.invalidateQueries({ queryKey: automationKeys.all }),
      ),
    };
  }
  return bridge;
}

// A hot-replaced module wires again, so the old listener must not invalidate twice.
import.meta.hot?.dispose(() => {
  wired?.stop();
  wired = null;
});

/** How long a trigger's preview stays fresh and cached; a held schedule's next runs move on. */
const PREVIEW_LIFETIME_MS = 60_000;

/**
 * Reads automation data while the service is connected; failures show in place, not as toasts.
 * Lists stay cached for the window's life (a hidden section keeps its rows); a `transient` read,
 * one per edited trigger, stays fresh for a minute, keeps its previous answer while the next one
 * loads, and is dropped soon after nothing shows it.
 */
function useAutomationsQuery<T>(
  queryKey: readonly unknown[],
  read: ((bridge: AutomationsBridge) => Promise<T>) | null,
  transient = false,
) {
  const connected = useServiceStatus().status?.state === 'connected';
  const available = Boolean(window.desktop?.automations) && connected;
  const queryFn: QueryFunction<T> | typeof skipToken =
    read && available ? () => read(automationsBridge()) : skipToken;
  return useQuery(
    {
      queryKey,
      queryFn,
      meta: { errorToast: false },
      ...(transient
        ? {
            placeholderData: keepPreviousData,
            staleTime: PREVIEW_LIFETIME_MS,
            gcTime: PREVIEW_LIFETIME_MS,
          }
        : { gcTime: Infinity }),
    },
    queryClient,
  );
}

/**
 * Every automation with its live status, the global pause, and why the saved automations could
 * not be read (runtime text). `automations` is null until the first read answers.
 */
export function useAutomations() {
  const { data, error, isLoading, refetch } = useAutomationsQuery(automationKeys.list, (bridge) =>
    bridge.list(),
  );
  return {
    automations: data?.automations ?? null,
    paused: data?.paused ?? false,
    problem: data?.problem ?? null,
    loading: isLoading,
    error: error ? messageOf(error) : null,
    retry: () => void refetch(),
  };
}

/** One automation's runs, newest first; null until read. */
export function useAutomationRuns(id: string) {
  const { data, error, refetch } = useAutomationsQuery(automationKeys.runs(id), (bridge) =>
    bridge.runs(id),
  );
  return {
    runs: data ?? null,
    error: error ? messageOf(error) : null,
    retry: () => void refetch(),
  };
}

/** `value` once it has held still for `delay` ms; the first value counts at once. */
function useSettledValue(value: string, delay: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (value === settled) return;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, settled, delay]);
  return settled;
}

/**
 * The service's preview of a trigger being edited: its next run times and the problem that keeps
 * it from running. It asks once the trigger held still for a moment and only for a trigger the
 * contract accepts (the editor words the rest itself); the previous answer stays while the next
 * one loads. `automationId` lets the service report a chain back to the edited automation.
 */
export function useTriggerPreview(trigger: AutomationTrigger, automationId: string | null) {
  const settled = useSettledValue(JSON.stringify(trigger), PREVIEW_DELAY_MS);
  const request = useMemo((): PreviewAutomationTriggerRequest | null => {
    const candidate: unknown = JSON.parse(settled);
    if (!Value.Check(AutomationTriggerSchema, candidate)) return null;
    return { trigger: candidate, ...(automationId ? { automationId } : {}), count: PREVIEW_COUNT };
  }, [settled, automationId]);
  const { data, error, isFetching } = useAutomationsQuery(
    automationKeys.preview(settled, automationId),
    request ? (bridge) => bridge.preview(request) : null,
    true,
  );
  return {
    /** Null until the first answer, and while the trigger is not one the contract accepts. */
    preview: request ? (data ?? null) : null,
    error: error ? messageOf(error) : null,
    /** A newer trigger than the one shown is waiting or loading. */
    pending: settled !== JSON.stringify(trigger) || isFetching,
  };
}

/** A trigger's preview as the editor's trigger section shows it. */
export type TriggerPreview = ReturnType<typeof useTriggerPreview>;

/**
 * Run now, reported by toast: started (its task shows in the panel; a memory consolidation starts
 * no task, so its result shows in the run history), already running, or why it could not start.
 * The list follows the run through the `automations` invalidation.
 */
export function startRun(item: AutomationItem, t: TFunction<'automations'>) {
  const { id, name } = item.automation;
  // A run of an automation that cannot run as saved would only fail its preflight, and count
  // toward the failures that turn it off.
  if (item.status.problem) {
    showErrorToast(problemWords(item.status.problem, t));
    return;
  }
  void automationsBridge()
    .run(id)
    .then(
      () =>
        showToast({
          kind: 'info',
          text:
            item.automation.action.kind === 'consolidateMemory'
              ? t('list.startedMemory')
              : t('list.started'),
        }),
      (error: unknown) =>
        showErrorToast(
          error instanceof AutomationConflictError
            ? t('list.alreadyRunning', { name })
            : failureWords(error, t),
        ),
    );
}
