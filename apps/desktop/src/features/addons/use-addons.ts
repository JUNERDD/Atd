import { useMemo } from 'react';
import { mutationOptions, skipToken, useMutation, useQuery } from '@tanstack/react-query';
import type { AddonView } from '@atd/agent-contracts';
import type { AddonsBridge } from '../../client/addons-contract';
import { messageOf } from '../../lib/errors';
import { queryClient } from '../../lib/query-client';
import { useServiceStatus } from '../service/use-service';

/** Query keys of the add-on data; one invalidation of `all` reloads it. */
export const addonKeys = {
  all: ['addons'],
  list: ['addons', 'list'],
} as const;

/** How often a view reads the list while an add-on is downloading, verifying or installing. */
const PHASE_REFRESH_MS = 500;

let wired: { bridge: AddonsBridge; stop: () => void } | null = null;

/**
 * The add-ons bridge, or null outside the app (tests, a plain browser), with the cache following
 * its changes: an `addons` invalidation or a reconnect reloads the list of this window, whichever
 * page shows it. Wired once per bridge.
 */
export function addonsBridge(): AddonsBridge | null {
  const bridge = window.desktop?.addons ?? null;
  if (bridge && wired?.bridge !== bridge) {
    wired?.stop();
    wired = {
      bridge,
      stop: bridge.onChange(() => void queryClient.invalidateQueries({ queryKey: addonKeys.all })),
    };
  }
  return bridge;
}

import.meta.hot?.dispose(() => {
  wired?.stop();
  wired = null;
});

/**
 * Every add-on while the service is connected. The service sends an invalidation for each phase
 * change but none per byte, so the list is read again every half second while any add-on works.
 * `connected` is false without a service connection, when nothing can change.
 */
export function useAddons() {
  const connected = useServiceStatus().status?.state === 'connected';
  const bridge = addonsBridge();
  const { data, error, refetch } = useQuery(
    {
      queryKey: addonKeys.list,
      queryFn: bridge && connected ? async () => (await bridge.list()).addons : skipToken,
      meta: { errorToast: false },
      refetchInterval: (query) =>
        query.state.data?.some((addon) => addon.phase !== 'idle') ? PHASE_REFRESH_MS : false,
      refetchIntervalInBackground: false,
      gcTime: Infinity,
    },
    queryClient,
  );
  return {
    connected: Boolean(bridge) && connected,
    addons: data ?? null,
    error: error ? messageOf(error) : null,
    retry: () => void refetch(),
  };
}

/** One add-on's view; null until the list is read, or when this build does not know the id. */
export function useAddon(id: string) {
  const { addons, ...rest } = useAddons();
  const addon: AddonView | null = addons?.find((entry) => entry.id === id) ?? null;
  return { ...rest, loaded: addons !== null, addon };
}

/** A write whose failure the card shows in place: the card, not a toast, says what happened. */
export type AddonResult = { ok: true } | { ok: false; error: string };

const writeOptions = (name: 'install' | 'cancel' | 'remove') =>
  mutationOptions({
    mutationKey: ['addons', name],
    meta: { errorToast: false },
    mutationFn: async (id: string) => {
      const bridge = addonsBridge();
      if (!bridge) throw new Error('Open the desktop app to manage add-ons.');
      await bridge[name](id);
    },
    // A rejected write still moved the add-on's state, such as the `inUse` error of a removal.
    onSettled: () => queryClient.invalidateQueries({ queryKey: addonKeys.all }),
  });

const inPlace = (write: Promise<void>): Promise<AddonResult> =>
  write.then(
    () => ({ ok: true }),
    (error: unknown) => ({ ok: false, error: messageOf(error) }),
  );

/** Install (also Update and Try again), Cancel and Remove, each answering ok or its error. */
export function useAddonMutations() {
  const installWrite = useMutation(writeOptions('install'), queryClient).mutateAsync;
  const cancelWrite = useMutation(writeOptions('cancel'), queryClient).mutateAsync;
  const removeWrite = useMutation(writeOptions('remove'), queryClient).mutateAsync;
  return useMemo(
    () => ({
      install: (id: string) => inPlace(installWrite(id)),
      cancel: (id: string) => inPlace(cancelWrite(id)),
      remove: (id: string) => inPlace(removeWrite(id)),
    }),
    [installWrite, cancelWrite, removeWrite],
  );
}
