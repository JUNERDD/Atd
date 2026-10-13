import { keyringAccount, KeyringUnavailable } from '../credentials/keyring.js';
import { withCredentialLock } from '../credentials/service-store.js';
import type { ProviderStores } from './runtime.js';

/** Retired tokens stay unusable even if the keychain is temporarily unavailable for cleanup. */
export async function cleanupRetiredCredentials(stores: ProviderStores): Promise<void> {
  for (const connection of stores.connections.data.connections) {
    if (!connection.credentialCleanupPending) continue;
    try {
      await withCredentialLock(connection.connectionId, () =>
        stores.connections.change(async (data) => {
          const current = data.connections.find(
            (item) => item.connectionId === connection.connectionId,
          );
          if (!current?.credentialCleanupPending) return;
          await stores.keyring.delete(keyringAccount(current.connectionId));
          delete current.credentialCleanupPending;
        }),
      );
    } catch (error) {
      if (!(error instanceof KeyringUnavailable)) throw error;
    }
  }
}
