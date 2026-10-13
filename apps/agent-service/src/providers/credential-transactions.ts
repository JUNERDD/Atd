import type { ConnectionStore } from '../credentials/connections.js';
import { keyringAccount, KeyringBackend, KeyringUnavailable } from '../credentials/keyring.js';
import { withCredentialLock } from '../credentials/service-store.js';

/** Failed creates keep an unusable cleanup record until their keyring entry can be removed. */
export async function discardCreatedConnection(
  connections: ConnectionStore,
  keyring: KeyringBackend,
  connectionId: string,
  expectedRevision: number,
): Promise<void> {
  await withCredentialLock(connectionId, async () => {
    let commit = async (): Promise<void> => {};
    await connections.change(
      (data) => {
        const connection = data.connections.find((item) => item.connectionId === connectionId);
        // A concurrent successful edit or reconnect now owns this row and its credential.
        if (!connection || connection.revision !== expectedRevision) return;
        connection.connected = false;
        connection.hasCredential = false;
        connection.credentialCleanupPending = true;
        connection.verifiedModel = '';
        connection.defaultModel = '';
        connection.revision += 1;
        // This failed create only needs an identity for cleanup or explicit reconfiguration.
        // Replacing its 64-byte configuration hash with the connection UUID also invalidates
        // old bindings and keeps this recovery row smaller even when shared storage is full.
        connection.configurationId = connectionId;
        delete connection.accountLabel;
        delete connection.authNotice;
        delete connection.options;
        delete connection.customModels;
        delete connection.catalog;
        delete connection.catalogError;
        delete connection.contextTiers;
        delete connection.defaultThinkingLevel;
        if (data.defaultConnectionId === connectionId) data.defaultConnectionId = null;
        commit = async () => {
          try {
            await keyring.delete(keyringAccount(connectionId));
          } catch (error) {
            if (error instanceof KeyringUnavailable) return;
            throw error;
          }
          // Removing the prepared cleanup row only shrinks the already validated draft.
          data.connections = data.connections.filter((item) => item !== connection);
        };
      },
      () => commit(),
    );
  });
}
