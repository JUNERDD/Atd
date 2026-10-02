import type { SecretStore } from '@atd/plugin-kit';
import {
  KeyringBackend,
  KeyringUnavailable,
  keyringPluginAccount,
} from '../credentials/keyring.js';
import type { Logger } from '../logging.js';

/**
 * plugin-kit's `SecretStore` port over the service keyring (credentials/keyring.ts), in the
 * service's own keyring namespace. Writes fail loudly when no durable keyring exists, so a
 * sensitive value is never kept anywhere else. A read that cannot reach the keyring answers
 * "not set" with a warning: the plugin then reports that it needs configuration instead of the
 * whole plugin list failing.
 */
export function keyringSecretStore(serviceId: string, log: Logger): SecretStore {
  const keyring = new KeyringBackend(serviceId);
  return {
    async get(pluginId, key) {
      try {
        return (await keyring.get(keyringPluginAccount(pluginId, key))) ?? null;
      } catch (error) {
        if (!(error instanceof KeyringUnavailable)) throw error;
        log.warn('Plugin secret could not be read from the keyring.', {
          pluginId,
          key,
          error: error.message,
        });
        return null;
      }
    },
    async set(pluginId, key, value) {
      await keyring.set(keyringPluginAccount(pluginId, key), value);
    },
    async delete(pluginId, key) {
      await keyring.delete(keyringPluginAccount(pluginId, key));
    },
  };
}
