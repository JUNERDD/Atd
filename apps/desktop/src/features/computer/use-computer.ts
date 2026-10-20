import { useCallback, useSyncExternalStore } from 'react';
import { keepPreviousData, skipToken, useQuery } from '@tanstack/react-query';
import type { ComputerStatusResponse, TargetBinding } from '@atd/agent-contracts';
import type { ComputerBridge, ComputerShellState } from '../../client/computer-contract';
import { messageOf } from '../../lib/errors';
import { queryClient } from '../../lib/query-client';
import { useServiceStatus } from '../service/use-service';

/** Query keys of the computer data; one invalidation of `all` reloads it. */
export const computerKeys = {
  all: ['computer'],
  status: ['computer', 'status'],
  unresolved: ['computer', 'unresolved'],
} as const;

/**
 * How often an open view reads the targets again: the service sends no invalidation when a run
 * starts or stops using one, so busy targets would otherwise stay as first read.
 */
const STATUS_REFRESH_MS = 5000;

let wired: { bridge: ComputerBridge; stop: () => void } | null = null;

/**
 * The computer bridge, or null outside the app (tests, a plain browser), with the cache following
 * its changes: a host state change, a prepared target or a reconnect reloads the computer queries
 * of this window. Wired once per bridge.
 */
export function computerBridge(): ComputerBridge | null {
  const bridge = window.desktop?.computer ?? null;
  if (bridge && wired?.bridge !== bridge) {
    wired?.stop();
    wired = {
      bridge,
      stop: bridge.onChange(
        () => void queryClient.invalidateQueries({ queryKey: computerKeys.all }),
      ),
    };
  }
  return bridge;
}

import.meta.hot?.dispose(() => {
  wired?.stop();
  wired = null;
});

/**
 * The service's computer status while it is connected: the host, the registered targets and which
 * of them runs are using. `status` is null until the first read answers or without the bridge.
 * A `live` view (the settings page) reads it again every few seconds to follow busy targets.
 */
export function useComputerStatus({ live = false }: { live?: boolean } = {}) {
  const connected = useServiceStatus().status?.state === 'connected';
  const bridge = computerBridge();
  const { data, error, refetch } = useQuery<ComputerStatusResponse>(
    {
      queryKey: computerKeys.status,
      queryFn: bridge && connected ? () => bridge.status() : skipToken,
      meta: { errorToast: false },
      refetchInterval: live ? STATUS_REFRESH_MS : false,
      refetchIntervalInBackground: false,
      gcTime: Infinity,
    },
    queryClient,
  );
  return {
    available: Boolean(bridge),
    status: data ?? null,
    error: error ? messageOf(error) : null,
    retry: () => void refetch(),
  };
}

/**
 * Whether the service still lists action `actionId` of the task among those awaiting a person's
 * check (`bridge.unresolvedFacts`), read per task and again when `revision` (the task's runs and
 * their states) changes or the computer data is invalidated. False until the read answers and
 * when it fails or `enabled` is false, so a control that depends on it stays hidden rather than
 * offering an action the service would ignore.
 */
export function useActionUnresolved(
  taskId: string,
  actionId: string,
  revision: string,
  enabled: boolean,
): boolean {
  const connected = useServiceStatus().status?.state === 'connected';
  const bridge = computerBridge();
  // One read per task and revision, shared by every row of the task; each row selects its own id.
  const { data } = useQuery<readonly string[], Error, boolean>(
    {
      queryKey: [...computerKeys.unresolved, taskId, revision],
      queryFn: bridge && connected && enabled ? () => bridge.unresolvedFacts(taskId) : skipToken,
      select: (actionIds) => actionIds.includes(actionId),
      meta: { errorToast: false },
      placeholderData: keepPreviousData,
      retry: false,
    },
    queryClient,
  );
  return enabled && data === true;
}

/** Reloads the computer status now, after this window changed it. */
export function refreshComputer() {
  void queryClient.invalidateQueries({ queryKey: computerKeys.all });
}

const shellStates = new WeakMap<ComputerBridge, ComputerShellState>();

/** The shell's computer host state (`computer.state`); null until the shell reports one. */
export function useComputerShellState(): ComputerShellState | null {
  const bridge = computerBridge();
  const subscribe = useCallback(
    (notify: () => void) =>
      bridge
        ? bridge.onState((state) => {
            shellStates.set(bridge, state);
            notify();
          })
        : () => undefined,
    [bridge],
  );
  return useSyncExternalStore(subscribe, () => (bridge ? (shellStates.get(bridge) ?? null) : null));
}

/** Whether a binding is a browser environment, for the icon and copy each kind takes. */
export function isBrowserBinding(
  binding: TargetBinding,
): binding is Extract<TargetBinding, { kind: 'browser' }> {
  return binding.kind === 'browser';
}

/** The run using a binding right now, if any. */
export function busyRun(status: ComputerStatusResponse | null, bindingId: string) {
  return status?.busy.find((entry) => entry.bindingId === bindingId) ?? null;
}
