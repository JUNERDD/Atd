import { useState } from 'react';
import { addonFailure, addonState } from './addon-state';
import { useAddon, useAddonMutations } from './use-addons';

type Write = 'install' | 'cancel' | 'remove';

/**
 * One add-on card's data and writes. A write answers at once and the outcome arrives through the
 * list, so `pending` only covers the request itself; a request the service never answered (no
 * connection) shows as `requestError` until the next write, since the list has nothing to say.
 */
export function useAddonCard(id: string) {
  const { addon, connected, error: loadError, retry } = useAddon(id);
  const mutations = useAddonMutations();
  const [pending, setPending] = useState<Write | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  async function run(write: Write) {
    if (pending) return;
    setPending(write);
    setRequestError(null);
    const result = await mutations[write](id);
    if (!result.ok) setRequestError(result.error);
    setPending(null);
  }

  const state = addonState(addon);
  const failure = addonFailure(addon);
  return {
    addon,
    state,
    failure,
    // A removal the service refused leaves the add-on installed with its reason in the list.
    requestError: state === 'working' || failure ? null : requestError,
    loadError: addon ? null : loadError,
    pending,
    // Nothing can change without a service connection.
    disabled: !connected || pending !== null,
    retry,
    install: () => void run('install'),
    cancel: () => void run('cancel'),
    remove: () => void run('remove'),
  };
}
