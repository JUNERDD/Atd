import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  Identifier,
  parse,
  ProviderConnectRequestSchema,
  ProviderCreateRequestSchema,
  ProviderDisconnectRequestSchema,
  type ServiceConnection,
} from '@ai/agent-contracts';
import { ConnectionStore, serviceConfigurationId } from '../credentials/connections.js';
import { KeyringBackend } from '../credentials/keyring.js';
import { ServiceCredentialStore } from '../credentials/service-store.js';
import { ConflictError } from '../errors.js';
import { getServiceCatalog } from './catalog.js';
import { modelCheck, storeConnectionCredential, type CredentialCheck } from './credential.js';
import { registerConnectionRoutes } from './connection-routes.js';
import { mustConnection, presentConnection, presentStored } from './connection-view.js';
import { ProviderLogins } from './login.js';
import type { ProviderStores } from './runtime.js';
import { RENDERER_ROUTE } from '../relay-routes.js';

export interface ProviderRouteContext {
  serviceId: string;
  dataDir: string;
}

/** Matches `ServiceConnectionsFileSchema`'s `connections` maxItems. */
const CONNECTION_LIMIT = 100;

/**
 * Live provider routes (T6b) over the T2 connection store, keyring backend
 * and credential store: list/get/status/create/connect/disconnect here, edits,
 * preferences, thinking levels, refresh, verification and sign-in in
 * connection-routes. Status, create and connect run the local model check
 * (credential resolution only, never network).
 */
export function registerProviderRoutes(app: FastifyInstance, ctx: ProviderRouteContext): void {
  const stores = async (): Promise<ProviderStores> => ({
    dataDir: ctx.dataDir,
    connections: await ConnectionStore.load(ctx.dataDir),
    keyring: new KeyringBackend(ctx.serviceId),
  });
  const logins = new ProviderLogins();

  app.get('/v1/providers', RENDERER_ROUTE, async () => {
    const { connections } = await stores();
    return {
      defaultConnectionId: connections.data.defaultConnectionId,
      connections: await Promise.all(connections.data.connections.map(presentConnection)),
    };
  });

  // Static catalog before the :connectionId param so "catalog" never captures as an id.
  app.get('/v1/providers/catalog', RENDERER_ROUTE, async () => {
    return { catalog: await getServiceCatalog() };
  });

  /**
   * Create and connect in one step. The record and its credential land
   * together: a keyring failure removes the connection again, so a retry
   * cannot accumulate half-created rows the caller never saw. Without a
   * credential the connection is saved disconnected; account-login
   * connections receive theirs from sign-in.
   */
  app.post('/v1/providers', RENDERER_ROUTE, async (request) => {
    const body = parse(ProviderCreateRequestSchema, request.body);
    const { connections, keyring } = await stores();
    const connection: ServiceConnection = {
      connectionId: randomUUID(),
      provider: body.provider,
      name: body.name,
      baseUrl: body.baseUrl,
      authType: body.authType,
      defaultModel: body.defaultModel,
      revision: 1,
      connected: false,
      hasCredential: false,
      configurationId: serviceConfigurationId({
        provider: body.provider,
        baseUrl: body.baseUrl,
        authType: body.authType,
        options: body.options,
        customModels: body.customModels,
      }),
      verifiedModel: '',
      migratedAt: null,
      options: body.options,
      customModels: body.customModels,
      ...(body.defaultThinkingLevel ? { defaultThinkingLevel: body.defaultThinkingLevel } : {}),
    };
    const previousDefault = connections.data.defaultConnectionId;
    await connections.change((data) => {
      if (data.connections.length >= CONNECTION_LIMIT)
        throw new TypeError('The connection limit is reached. Remove one before adding another.');
      data.connections.push(connection);
      // The first connected connection becomes the default so a run can
      // resolve a model without a separate preference write.
      if (body.credential) data.defaultConnectionId ??= connection.connectionId;
    });
    if (body.credential === null)
      return {
        connection: await presentStored(connections, connection.connectionId),
        readable: false,
        modelCheck: 'unchecked' as const,
      };
    try {
      const outcome = await storeConnectionCredential(connections, keyring, {
        connectionId: connection.connectionId,
        providerId: connection.provider,
        configurationId: connection.configurationId,
        credential: body.credential,
      });
      return {
        connection: await presentStored(connections, connection.connectionId),
        readable: outcome.readable,
        modelCheck: outcome.modelCheck,
      };
    } catch (error) {
      await connections.change((data) => {
        data.connections = data.connections.filter(
          (item) => item.connectionId !== connection.connectionId,
        );
        data.defaultConnectionId = previousDefault;
      });
      throw mapUploadError(error);
    }
  });

  app.get<{ Params: { connectionId: string } }>(
    '/v1/providers/:connectionId',
    RENDERER_ROUTE,
    async (request) => {
      const { connections } = await stores();
      return {
        connection: await presentStored(
          connections,
          parse(Identifier, request.params.connectionId),
        ),
      };
    },
  );

  app.get<{ Params: { connectionId: string } }>(
    '/v1/providers/:connectionId/status',
    RENDERER_ROUTE,
    async (request) => {
      const { connections, keyring } = await stores();
      const connection = mustConnection(
        connections,
        parse(Identifier, request.params.connectionId),
      );
      const [probe, check] = await Promise.all([
        keyring.status(),
        modelCheck(connections, keyring, connection.connectionId),
      ]);
      return {
        connection: await presentConnection(connection),
        keyring: {
          available: probe.available,
          backend: probe.backend,
          detail: probe.detail.slice(0, 2000),
        },
        modelCheck: check.modelCheck,
        detail: check.detail.slice(0, 2000),
      };
    },
  );

  app.post<{ Params: { connectionId: string } }>(
    '/v1/providers/:connectionId/connect',
    RENDERER_ROUTE,
    async (request) => {
      const pathId = parse(Identifier, request.params.connectionId);
      const body = parse(ProviderConnectRequestSchema, request.body);
      if (body.connectionId !== pathId)
        throw new TypeError('Invalid data: path id and body connectionId differ.');
      const { connections, keyring } = await stores();
      mustConnection(connections, pathId);
      let outcome: CredentialCheck;
      try {
        outcome = await storeConnectionCredential(connections, keyring, body);
      } catch (error) {
        throw mapUploadError(error);
      }
      return {
        connection: await presentStored(connections, pathId),
        readable: outcome.readable,
        modelCheck: outcome.modelCheck,
      };
    },
  );

  app.post<{ Params: { connectionId: string } }>(
    '/v1/providers/:connectionId/disconnect',
    RENDERER_ROUTE,
    async (request) => {
      const pathId = parse(Identifier, request.params.connectionId);
      const body = parse(ProviderDisconnectRequestSchema, request.body);
      const { connections, keyring } = await stores();
      const live = mustConnection(connections, pathId);
      if (live.revision !== body.expectedRevision)
        throw new ConflictError('This connection changed. Reload before disconnecting.');
      logins.cancelConnection(pathId);
      if (live.hasCredential) {
        // Persisted secret: the keyring delete must succeed before flags clear;
        // a keyring failure stays an honest 500, never a faked disconnect.
        const credentialStore = new ServiceCredentialStore(
          keyring,
          connections,
          live.connectionId,
          live.provider,
          live.configurationId,
        );
        await credentialStore.delete(live.provider);
      } else {
        await connections.change((data) => {
          const item = data.connections.find((entry) => entry.connectionId === pathId);
          if (item) {
            item.hasCredential = false;
            item.connected = false;
          }
        });
      }
      return { connection: await presentStored(connections, pathId) };
    },
  );

  registerConnectionRoutes(app, stores, logins);
}

/** Stale-credential bindings are client state drift (409), not server faults. */
function mapUploadError(error: unknown): Error {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('wrong provider') || message.includes('configuration changed'))
    return new ConflictError(message);
  return error instanceof Error ? error : new Error('The credential could not be stored.');
}
