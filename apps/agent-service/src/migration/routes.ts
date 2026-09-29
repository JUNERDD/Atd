import type { FastifyInstance } from 'fastify';
import {
  CredentialUploadRequestSchema,
  parse,
  type MigrationCredentialRecord,
} from '@ai/agent-contracts';
import type { ServiceConfig } from '../config.js';
import { ConnectionStore } from '../credentials/connections.js';
import { KeyringBackend } from '../credentials/keyring.js';
import { applyCredentialUpload } from './import-providers.js';
import { ManifestStore } from './manifest.js';
import { SHELL_ROUTE } from '../relay-routes.js';

/**
 * Migration upload channel: the only route that accepts secret material, and
 * only over the service's authenticated loopback bearer channel. The desktop
 * decrypts each connection once with safeStorage and POSTs it here; the
 * service persists it to the keyring and records a secret-free verdict in
 * the manifest. No plaintext temp files on either side.
 */
export function registerMigrationRoutes(
  app: FastifyInstance,
  config: Pick<ServiceConfig, 'serviceId' | 'paths'>,
): void {
  app.post('/v1/migration/credentials', SHELL_ROUTE, async (request) => {
    const upload = parse(CredentialUploadRequestSchema, request.body);
    const connections = await ConnectionStore.load(config.paths.root);
    const keyring = new KeyringBackend(config.serviceId);
    const outcome = await applyCredentialUpload(connections, keyring, upload);
    const manifest = await ManifestStore.read(config.paths.root);
    if (manifest) {
      const store = await ManifestStore.load(
        config.paths.root,
        manifest.serviceId,
        manifest.sourceRoot,
      );
      const stored = connections.connection(upload.connectionId);
      const record: MigrationCredentialRecord = {
        connectionId: upload.connectionId,
        provider: stored.provider,
        uploaded: true,
        readable: outcome.readable,
        modelCheck: outcome.modelCheck,
        detail: outcome.detail.slice(0, 2000),
      };
      await store.recordCredential(record);
    }
    return {
      connectionId: upload.connectionId,
      readable: outcome.readable,
      modelCheck: outcome.modelCheck,
    };
  });

  app.get('/v1/migration/status', SHELL_ROUTE, async () => ({
    manifest: await ManifestStore.read(config.paths.root),
  }));
}
