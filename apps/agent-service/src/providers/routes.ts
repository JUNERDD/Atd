import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  Identifier,
  parse,
  ProviderConnectRequestSchema,
  ProviderDisconnectRequestSchema,
  type ServiceConnection,
} from '@ai/agent-contracts';
import { ConnectionStore } from '../credentials/connections.js';
import { KeyringBackend } from '../credentials/keyring.js';
import { ServiceCredentialStore } from '../credentials/service-store.js';
import { ConflictError } from '../errors.js';
import { LedgerNotFound } from '../ledger.js';
import { applyCredentialUpload, modelCheck } from '../migration/import-providers.js';
import { getServiceCatalog } from './catalog.js';

export interface ProviderRouteContext {
  serviceId: string;
  dataDir: string;
}

/**
 * Live provider routes (T6b) over the T2 connection store, keyring backend
 * and credential store: list/get/status/connect/disconnect. Status and
 * connect reuse the T2 local model check (credential resolution only, never
 * network). Connection create/update, default/model preference writes and
 * interactive login stay explicit 501s (owner T6 followup): the settings UI
 * surfaces them honestly instead of a faked success.
 */
export function registerProviderRoutes(app: FastifyInstance, ctx: ProviderRouteContext): void {
  const stores = async () => ({
    connections: await ConnectionStore.load(ctx.dataDir),
    keyring: new KeyringBackend(ctx.serviceId),
  });

  app.get('/v1/providers', async () => {
    const { connections } = await stores();
    return {
      defaultConnectionId: connections.data.defaultConnectionId,
      connections: connections.data.connections,
    };
  });

  // Static catalog before the :connectionId param so "catalog" never captures as an id.
  app.get('/v1/providers/catalog', async () => {
    return { catalog: await getServiceCatalog() };
  });

  app.get<{ Params: { connectionId: string } }>('/v1/providers/:connectionId', async (request) => {
    const { connections } = await stores();
    return {
      connection: mustConnection(connections, parse(Identifier, request.params.connectionId)),
    };
  });

  app.get<{ Params: { connectionId: string } }>(
    '/v1/providers/:connectionId/status',
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
        connection,
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
    async (request) => {
      const pathId = parse(Identifier, request.params.connectionId);
      const body = parse(ProviderConnectRequestSchema, request.body);
      if (body.connectionId !== pathId)
        throw new TypeError('Invalid data: path id and body connectionId differ.');
      const { connections, keyring } = await stores();
      mustConnection(connections, pathId);
      let outcome: { readable: boolean; modelCheck: 'unchecked' | 'passed' | 'failed' };
      try {
        outcome = await applyCredentialUpload(connections, keyring, body);
      } catch (error) {
        throw mapUploadError(error);
      }
      return {
        connection: mustConnection(connections, pathId),
        readable: outcome.readable,
        modelCheck: outcome.modelCheck,
      };
    },
  );

  app.post<{ Params: { connectionId: string } }>(
    '/v1/providers/:connectionId/disconnect',
    async (request) => {
      const pathId = parse(Identifier, request.params.connectionId);
      const body = parse(ProviderDisconnectRequestSchema, request.body);
      const { connections, keyring } = await stores();
      const live = mustConnection(connections, pathId);
      if (live.revision !== body.expectedRevision)
        throw new ConflictError('This connection changed. Reload before disconnecting.');
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
      return { connection: mustConnection(connections, pathId) };
    },
  );

  for (const future of FUTURE_PROVIDER_ROUTES) {
    const handler = async (_request: FastifyRequest, reply: FastifyReply) =>
      reply.status(501).send({
        error: { code: 'not_implemented', message: future.message, owner: 'T6' },
      });
    if (future.method === 'GET') app.get(future.path, handler);
    else if (future.method === 'PUT') app.put(future.path, handler);
    else app.post(future.path, handler);
  }
}

function mustConnection(store: ConnectionStore, connectionId: string): ServiceConnection {
  try {
    return store.connection(connectionId);
  } catch {
    throw new LedgerNotFound('Connection', connectionId);
  }
}

/** Stale-credential bindings are client state drift (409), not server faults. */
function mapUploadError(error: unknown): Error {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('wrong provider') || message.includes('configuration changed'))
    return new ConflictError(message);
  return error instanceof Error ? error : new Error('The credential could not be stored.');
}

const FUTURE_PROVIDER_ROUTES: { method: 'GET' | 'POST' | 'PUT'; path: string; message: string }[] =
  [
    {
      method: 'POST',
      path: '/v1/providers',
      message: 'Provider creation is not implemented yet (owner T6 followup).',
    },
    {
      method: 'PUT',
      path: '/v1/providers/:connectionId',
      message: 'Provider editing is not implemented yet (owner T6 followup).',
    },
    {
      method: 'POST',
      path: '/v1/providers/:connectionId/default',
      message: 'Default-connection switching is not implemented yet (owner T6 followup).',
    },
    {
      method: 'POST',
      path: '/v1/providers/:connectionId/model',
      message: 'Default-model switching is not implemented yet (owner T6 followup).',
    },
    {
      method: 'GET',
      path: '/v1/providers/:connectionId/levels',
      message: 'Thinking-level lookup is not implemented yet (owner T6 followup).',
    },
    {
      method: 'POST',
      path: '/v1/providers/:connectionId/refresh',
      message: 'Catalog refresh is not implemented yet (owner T6 followup).',
    },
    {
      method: 'POST',
      path: '/v1/providers/:connectionId/verify',
      message: 'Model verification is not implemented yet (owner T6 followup).',
    },
    {
      method: 'POST',
      path: '/v1/providers/:connectionId/login',
      message: 'Interactive provider login is not implemented yet (owner T6 followup).',
    },
    {
      method: 'POST',
      path: '/v1/providers/logins/:id/answer',
      message: 'Interactive provider login is not implemented yet (owner T6 followup).',
    },
    {
      method: 'POST',
      path: '/v1/providers/logins/:id/cancel',
      message: 'Interactive provider login is not implemented yet (owner T6 followup).',
    },
    {
      method: 'POST',
      path: '/v1/providers/logins/:id/open-link',
      message: 'Interactive provider login is not implemented yet (owner T6 followup).',
    },
  ];
