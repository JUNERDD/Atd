import type { FastifyInstance } from 'fastify';
import { clampThinkingLevel, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import {
  Identifier,
  parse,
  ProviderDefaultRequestSchema,
  ProviderLevelsQuerySchema,
  ProviderLoginAnswerRequestSchema,
  ProviderModelRequestSchema,
  ProviderUpdateRequestSchema,
  ProviderVerifyRequestSchema,
  type ProviderUpdateRequest,
  type ServiceConnection,
} from '@ai/agent-contracts';
import { serviceConfigurationId } from '../credentials/connections.js';
import { keyringAccount } from '../credentials/keyring.js';
import { ConflictError } from '../errors.js';
import { mustConnection, presentConnection, presentStored } from './connection-view.js';
import type { ProviderLogins } from './login.js';
import { connectionModel, refreshCatalog, verifyModel, type ProviderStores } from './runtime.js';

const STALE = 'This connection changed. Reload its saved settings and try again.';

type Params = { Params: { connectionId: string } };

/**
 * Connection edits, preference writes, thinking levels, catalog refresh,
 * model verification and account sign-in. Every write names the revision the
 * caller read, and the revision check repeats inside the store's serialized
 * change, so two windows cannot silently overwrite each other.
 */
export function registerConnectionRoutes(
  app: FastifyInstance,
  stores: () => Promise<ProviderStores>,
  logins: ProviderLogins,
): void {
  const load = async (rawId: string) => {
    const opened = await stores();
    return { ...opened, live: mustConnection(opened.connections, parse(Identifier, rawId)) };
  };

  app.put<Params>('/v1/providers/:connectionId', async (request) => {
    const body = parse(ProviderUpdateRequestSchema, request.body);
    const { live, ...opened } = await load(request.params.connectionId);
    if (live.revision !== body.expectedRevision) throw new ConflictError(STALE);
    const { connections, keyring } = opened;
    if (
      live.authType === 'api_key' &&
      live.hasCredential &&
      live.baseUrl !== body.baseUrl &&
      body.credential.action === 'keep'
    )
      throw new TypeError(
        'Enter the API key again, or explicitly remove it, when changing the endpoint.',
      );
    // The secret moves first: a keyring failure leaves the saved connection untouched.
    const account = keyringAccount(live.connectionId);
    if (body.credential.action === 'replace')
      await keyring.set(account, JSON.stringify(body.credential.credential));
    else if (body.credential.action === 'remove' && live.hasCredential)
      await keyring.delete(account);
    await connections.change((data) => {
      const current = data.connections.find((item) => item.connectionId === live.connectionId);
      if (!current || current.revision !== body.expectedRevision) throw new ConflictError(STALE);
      applyUpdate(current, body);
    });
    return { connection: await presentStored(connections, live.connectionId) };
  });

  app.post<Params>('/v1/providers/:connectionId/default', async (request) => {
    const body = parse(ProviderDefaultRequestSchema, request.body);
    const { live, connections } = await load(request.params.connectionId);
    if (live.revision !== body.expectedRevision) throw new ConflictError(STALE);
    if (!live.connected)
      throw new ConflictError(`Reconnect ${live.name} before making it the default.`);
    if (!live.defaultModel) throw new TypeError('Choose a default model first.');
    const { catalog = [] } = await presentConnection(live);
    if (!catalog.some((model) => model.id === live.defaultModel))
      throw new TypeError(
        `The saved model ${live.defaultModel} is unavailable. Refresh or choose another model.`,
      );
    await connections.change((data) => {
      const current = data.connections.find((item) => item.connectionId === live.connectionId);
      if (!current || current.revision !== body.expectedRevision) throw new ConflictError(STALE);
      data.defaultConnectionId = current.connectionId;
    });
    return { defaultConnectionId: live.connectionId };
  });

  app.post<Params>('/v1/providers/:connectionId/model', async (request) => {
    const body = parse(ProviderModelRequestSchema, request.body);
    const { live, ...opened } = await load(request.params.connectionId);
    if (live.revision !== body.expectedRevision) throw new ConflictError(STALE);
    const { catalog = [] } = await presentConnection(live);
    if (!catalog.some((model) => model.id === body.modelId))
      throw new TypeError('This model is unavailable in the connection catalog.');
    const model = live.defaultThinkingLevel
      ? await connectionModel(opened, live, body.modelId)
      : undefined;
    await opened.connections.change((data) => {
      const current = data.connections.find((item) => item.connectionId === live.connectionId);
      if (!current || current.revision !== body.expectedRevision) throw new ConflictError(STALE);
      current.defaultModel = body.modelId;
      // The saved level belongs to the previous model; keep what the new one still supports.
      if (model && current.defaultThinkingLevel)
        current.defaultThinkingLevel = clampThinkingLevel(model, current.defaultThinkingLevel);
      current.revision += 1;
      if (!data.defaultConnectionId && current.connected)
        data.defaultConnectionId = current.connectionId;
    });
    return { connection: await presentStored(opened.connections, live.connectionId) };
  });

  app.get<Params>('/v1/providers/:connectionId/levels', async (request) => {
    const { modelId } = parse(ProviderLevelsQuerySchema, request.query);
    const { live, ...opened } = await load(request.params.connectionId);
    const model = await connectionModel(opened, live, modelId);
    return { levels: model ? getSupportedThinkingLevels(model) : [] };
  });

  app.post<Params>('/v1/providers/:connectionId/refresh', async (request) => {
    const { live, ...opened } = await load(request.params.connectionId);
    await refreshCatalog(opened, live);
    return { connection: await presentStored(opened.connections, live.connectionId) };
  });

  app.post<Params>('/v1/providers/:connectionId/verify', async (request) => {
    const body = parse(ProviderVerifyRequestSchema, request.body);
    const { live, ...opened } = await load(request.params.connectionId);
    await verifyModel(opened, live, body.modelId);
    return { connection: await presentStored(opened.connections, live.connectionId) };
  });

  app.post<Params>('/v1/providers/:connectionId/login', async (request) => {
    const { live, ...opened } = await load(request.params.connectionId);
    return { login: await logins.start(opened, live) };
  });

  app.get<{ Params: { loginId: string } }>('/v1/providers/logins/:loginId', async (request) => ({
    login: logins.get(parse(Identifier, request.params.loginId)),
  }));

  app.post<{ Params: { loginId: string } }>(
    '/v1/providers/logins/:loginId/answer',
    async (request) => {
      const body = parse(ProviderLoginAnswerRequestSchema, request.body);
      return {
        login: logins.answer(parse(Identifier, request.params.loginId), body.promptId, body.value),
      };
    },
  );

  app.post<{ Params: { loginId: string } }>(
    '/v1/providers/logins/:loginId/cancel',
    async (request) => ({ login: logins.cancel(parse(Identifier, request.params.loginId)) }),
  );
}

/**
 * Applies an edit to the stored record. A new configuration identity drops
 * the catalog and verification that belonged to the old one; a new or
 * removed secret drops the verification too.
 */
function applyUpdate(current: ServiceConnection, body: ProviderUpdateRequest): void {
  const configurationId = serviceConfigurationId({
    provider: current.provider,
    baseUrl: body.baseUrl,
    authType: current.authType,
    options: body.options,
    customModels: body.customModels,
  });
  const configurationChanged = configurationId !== current.configurationId;
  current.name = body.name;
  current.baseUrl = body.baseUrl;
  current.defaultModel = body.defaultModel;
  if (body.defaultThinkingLevel) current.defaultThinkingLevel = body.defaultThinkingLevel;
  else delete current.defaultThinkingLevel;
  current.options = body.options;
  current.customModels = body.customModels;
  current.configurationId = configurationId;
  current.revision += 1;
  if (body.credential.action !== 'keep') {
    current.hasCredential = body.credential.action === 'replace';
    current.connected = current.hasCredential;
  }
  if (configurationChanged) {
    delete current.catalog;
    delete current.catalogError;
  }
  if (configurationChanged || body.credential.action !== 'keep') current.verifiedModel = '';
}
