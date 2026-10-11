import type { FastifyInstance } from 'fastify';
import { clampThinkingLevel, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import {
  Identifier,
  parse,
  ProviderContextRequestSchema,
  ProviderContextsQuerySchema,
  ProviderDefaultRequestSchema,
  ProviderLevelsQuerySchema,
  ProviderLoginAnswerRequestSchema,
  ProviderLoginRequestSchema,
  ProviderModelRequestSchema,
  ProviderRefreshRequestSchema,
  ProviderUpdateRequestSchema,
  ProviderVerifyRequestSchema,
  type ProviderUpdateRequest,
  type ServiceConnection,
} from '@atd/agent-contracts';
import { serviceConfigurationId } from '../credentials/connections.js';
import { keyringAccount } from '../credentials/keyring.js';
import { withCredentialLock } from '../credentials/service-store.js';
import { ConflictError } from '../errors.js';
import {
  assertProviderModels,
  mustConnection,
  presentConnection,
  presentStored,
} from './connection-view.js';
import { connectionModelTiers, contextsResponse } from './context-tiers.js';
import type { ProviderLogins } from './login.js';
import { connectionModel, refreshCatalog, verifyModel, type ProviderStores } from './runtime.js';
import { RENDERER_ROUTE } from '../relay-routes.js';
import { assertProviderAuth, assertUploadedCredential } from './auth-policy.js';
import {
  isChatGPT,
  recordChatGPTConsent,
  resumeChatGPTUsage,
  withInferencePurpose,
} from './chatgpt-usage.js';

const STALE = 'This connection changed. Reload its saved settings and try again.';

type Params = { Params: { connectionId: string } };

/**
 * Connection edits, preference writes, thinking levels, context window tiers, catalog refresh,
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

  app.put<Params>('/v1/providers/:connectionId', RENDERER_ROUTE, async (request) => {
    const body = parse(ProviderUpdateRequestSchema, request.body);
    const { live, ...opened } = await load(request.params.connectionId);
    if (live.revision !== body.expectedRevision) throw new ConflictError(STALE);
    const { connections, keyring } = opened;
    assertProviderAuth({ ...live, ...body });
    assertProviderModels({ ...live, ...body });
    if (body.credential.action === 'replace')
      assertUploadedCredential({ ...live, ...body }, body.credential.credential);
    if (live.authType === 'oauth' && body.credential.action !== 'keep')
      throw new TypeError('Use sign-in or disconnect to change this account’s authorization.');
    if (
      live.authType === 'api_key' &&
      live.hasCredential &&
      live.baseUrl !== body.baseUrl &&
      body.credential.action === 'keep'
    )
      throw new TypeError(
        'Enter the API key again, or explicitly remove it, when changing the endpoint.',
      );
    await withCredentialLock(live.connectionId, async () => {
      let removeSecret = false;
      await connections.change(
        (data) => {
          const current = data.connections.find((item) => item.connectionId === live.connectionId);
          if (!current || current.revision !== body.expectedRevision)
            throw new ConflictError(STALE);
          removeSecret = Boolean(current.hasCredential || current.credentialCleanupPending);
          applyUpdate(current, body);
        },
        async () => {
          const account = keyringAccount(live.connectionId);
          if (body.credential.action === 'replace')
            await keyring.set(account, JSON.stringify(body.credential.credential));
          else if (body.credential.action === 'remove' && removeSecret)
            await keyring.delete(account);
        },
      );
    });
    if (body.resumeChatGPTUsage) resumeChatGPTUsage(live.connectionId);
    return { connection: await presentStored(connections, live.connectionId) };
  });

  app.post<Params>('/v1/providers/:connectionId/default', RENDERER_ROUTE, async (request) => {
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

  app.post<Params>('/v1/providers/:connectionId/model', RENDERER_ROUTE, async (request) => {
    const body = parse(ProviderModelRequestSchema, request.body);
    const { live, ...opened } = await load(request.params.connectionId);
    if (live.revision !== body.expectedRevision) throw new ConflictError(STALE);
    const { catalog = [] } = await presentConnection(live);
    if (!catalog.some((model) => model.id === body.modelId))
      throw new TypeError('This model is unavailable in the connection catalog.');
    const level = body.thinkingLevel ?? live.defaultThinkingLevel;
    const model = level ? await connectionModel(opened, live, body.modelId) : undefined;
    if (body.thinkingLevel && !model)
      throw new TypeError('This model does not offer thinking levels.');
    await opened.connections.change((data) => {
      const current = data.connections.find((item) => item.connectionId === live.connectionId);
      if (!current || current.revision !== body.expectedRevision) throw new ConflictError(STALE);
      current.defaultModel = body.modelId;
      // A requested level, or the saved one that belonged to the previous model, is kept only as
      // far as this model supports it.
      if (model && level) current.defaultThinkingLevel = clampThinkingLevel(model, level);
      current.revision += 1;
      if (!data.defaultConnectionId && current.connected)
        data.defaultConnectionId = current.connectionId;
    });
    return { connection: await presentStored(opened.connections, live.connectionId) };
  });

  app.get<Params>('/v1/providers/:connectionId/levels', RENDERER_ROUTE, async (request) => {
    const { modelId } = parse(ProviderLevelsQuerySchema, request.query);
    const { live, ...opened } = await load(request.params.connectionId);
    const model = await connectionModel(opened, live, modelId);
    return { levels: model ? getSupportedThinkingLevels(model) : [] };
  });

  app.get<Params>('/v1/providers/:connectionId/contexts', RENDERER_ROUTE, async (request) => {
    const { modelId } = parse(ProviderContextsQuerySchema, request.query);
    const { live } = await load(request.params.connectionId);
    const { catalog = [] } = await presentConnection(live);
    return contextsResponse(live, catalog, modelId);
  });

  app.put<Params>('/v1/providers/:connectionId/context', RENDERER_ROUTE, async (request) => {
    const body = parse(ProviderContextRequestSchema, request.body);
    const { live, connections } = await load(request.params.connectionId);
    if (live.revision !== body.expectedRevision) throw new ConflictError(STALE);
    const { catalog = [] } = await presentConnection(live);
    const derived = connectionModelTiers(live, catalog, body.modelId);
    if (!derived) throw new TypeError('This model has no context window choice.');
    await connections.change((data) => {
      const current = data.connections.find((item) => item.connectionId === live.connectionId);
      if (!current || current.revision !== body.expectedRevision) throw new ConflictError(STALE);
      // Only choices that differ from the default are stored; choosing the default forgets one.
      const tiers = { ...current.contextTiers };
      if (body.tier === derived.defaultTier) delete tiers[body.modelId];
      else tiers[body.modelId] = body.tier;
      if (Object.keys(tiers).length) current.contextTiers = tiers;
      else delete current.contextTiers;
      current.revision += 1;
    });
    return { connection: await presentStored(connections, live.connectionId) };
  });

  app.post<Params>('/v1/providers/:connectionId/refresh', RENDERER_ROUTE, async (request) => {
    const { background } = parse(ProviderRefreshRequestSchema, request.body);
    const { live, ...opened } = await load(request.params.connectionId);
    await refreshCatalog(opened, live, background);
    return { connection: await presentStored(opened.connections, live.connectionId) };
  });

  app.post<Params>('/v1/providers/:connectionId/verify', RENDERER_ROUTE, async (request) => {
    const body = parse(ProviderVerifyRequestSchema, request.body);
    const { live, ...opened } = await load(request.params.connectionId);
    await withInferencePurpose(false, () => verifyModel(opened, live, body.modelId));
    return { connection: await presentStored(opened.connections, live.connectionId) };
  });

  app.post<Params>('/v1/providers/:connectionId/login', RENDERER_ROUTE, async (request) => {
    const { live, ...opened } = await load(request.params.connectionId);
    const options = parse(ProviderLoginRequestSchema, request.body ?? {});
    return { login: await logins.start(opened, live, options) };
  });

  app.get<{ Params: { loginId: string } }>(
    '/v1/providers/logins/:loginId',
    RENDERER_ROUTE,
    async (request) => ({
      login: logins.get(parse(Identifier, request.params.loginId)),
    }),
  );

  app.post<{ Params: { loginId: string } }>(
    '/v1/providers/logins/:loginId/answer',
    RENDERER_ROUTE,
    async (request) => {
      const body = parse(ProviderLoginAnswerRequestSchema, request.body);
      return {
        login: logins.answer(parse(Identifier, request.params.loginId), body.promptId, body.value),
      };
    },
  );

  app.post<{ Params: { loginId: string } }>(
    '/v1/providers/logins/:loginId/cancel',
    RENDERER_ROUTE,
    async (request) => ({ login: await logins.cancel(parse(Identifier, request.params.loginId)) }),
  );
}

/**
 * Applies an edit to the stored record. A new configuration identity drops
 * the catalog and verification that belonged to the old one; a new or
 * removed secret drops the verification too.
 */
function applyUpdate(current: ServiceConnection, body: ProviderUpdateRequest): void {
  recordChatGPTConsent(current, body.chatgptConsent);
  if (body.resumeChatGPTUsage) {
    if (!isChatGPT(current)) throw new TypeError('Only ChatGPT connections can resume plan usage.');
    current.chatgptUsagePaused = false;
  }
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
    delete current.authNotice;
    delete current.credentialCleanupPending;
  }
  if (configurationChanged) {
    delete current.catalog;
    delete current.catalogError;
  }
  if (configurationChanged || body.credential.action !== 'keep') current.verifiedModel = '';
}
