import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  Identifier,
  MAX_MODEL_ALIASES,
  ModelAliasCreateRequestSchema,
  ModelAliasDefaultRequestSchema,
  ModelAliasesSeedRequestSchema,
  ModelAliasUpdateRequestSchema,
  parse,
  type ModelAlias,
  type ModelAliasDraft,
  type ServiceConnectionsFile,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import { LedgerNotFound } from '../ledger.js';
import { RENDERER_ROUTE } from '../relay-routes.js';
import type { ProviderStores } from './runtime.js';

type AliasParams = { Params: { aliasId: string } };

/** Validates and normalizes an alias draft against saved connections and existing alias names. */
function normalizeAliasDraft(
  raw: ModelAliasDraft,
  data: ServiceConnectionsFile,
  ignoreAliasId?: string,
  checkDuplicate = true,
): ModelAliasDraft {
  const name = raw.name.trim();
  if (!name) throw new TypeError('Model alias name cannot be empty.');
  const modelId = raw.modelId.trim();
  if (!modelId) throw new TypeError('Select a model for this alias.');
  if (!data.connections.some((item) => item.connectionId === raw.connectionId)) {
    throw new TypeError('The selected provider connection does not exist.');
  }
  if (checkDuplicate) {
    const key = name.toLowerCase();
    const conflict = (data.aliases ?? []).some(
      (item) => item.id !== ignoreAliasId && item.name.trim().toLowerCase() === key,
    );
    if (conflict) throw new ConflictError('A model alias with that name already exists.');
  }
  return {
    name,
    connectionId: raw.connectionId,
    modelId,
    ...(raw.contextChoice ? { contextChoice: raw.contextChoice } : {}),
    ...(raw.thinkingLevel ? { thinkingLevel: raw.thinkingLevel } : {}),
  };
}

/**
 * CRUD, seeding, and default-alias routes under `/v1/providers/aliases`.
 * Must be registered before `/v1/providers/:connectionId` so static segments resolve unambiguously.
 */
export function registerAliasRoutes(
  app: FastifyInstance,
  stores: () => Promise<ProviderStores>,
): void {
  app.post('/v1/providers/aliases', RENDERER_ROUTE, async (request) => {
    const body = parse(ModelAliasCreateRequestSchema, request.body);
    const { connections } = await stores();
    return connections.change((data) => {
      const aliases = (data.aliases ??= []);
      if (aliases.length >= MAX_MODEL_ALIASES) {
        throw new TypeError(`At most ${MAX_MODEL_ALIASES} model aliases can be saved.`);
      }
      const draft = normalizeAliasDraft(body, data);
      const alias: ModelAlias = { id: randomUUID(), ...draft };
      aliases.push(alias);
      return {
        alias,
        aliases: [...aliases],
        defaultAliasId: data.defaultAliasId ?? null,
      };
    });
  });

  app.post('/v1/providers/aliases/seed', RENDERER_ROUTE, async (request) => {
    const body = parse(ModelAliasesSeedRequestSchema, request.body);
    const { connections } = await stores();
    return connections.change((data) => {
      const aliases = (data.aliases ??= []);
      // Validate every entry upfront so seeding remains atomic even when some names are skipped.
      const normalized = body.aliases.map((item) =>
        normalizeAliasDraft(item, data, undefined, false),
      );
      const seen = new Set(aliases.map((item) => item.name.trim().toLowerCase()));
      for (const draft of normalized) {
        if (aliases.length >= MAX_MODEL_ALIASES) break;
        const key = draft.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        aliases.push({ id: randomUUID(), ...draft });
      }
      return {
        aliases: [...aliases],
        defaultAliasId: data.defaultAliasId ?? null,
      };
    });
  });

  app.put('/v1/providers/aliases/default', RENDERER_ROUTE, async (request) => {
    const body = parse(ModelAliasDefaultRequestSchema, request.body);
    const { connections } = await stores();
    return connections.change((data) => {
      const aliases = (data.aliases ??= []);
      if (
        body.defaultAliasId !== null &&
        !aliases.some((item) => item.id === body.defaultAliasId)
      ) {
        throw new LedgerNotFound('Model alias', body.defaultAliasId);
      }
      data.defaultAliasId = body.defaultAliasId;
      return { defaultAliasId: data.defaultAliasId };
    });
  });

  app.put<AliasParams>('/v1/providers/aliases/:aliasId', RENDERER_ROUTE, async (request) => {
    const aliasId = parse(Identifier, request.params.aliasId);
    const body = parse(ModelAliasUpdateRequestSchema, request.body);
    const { connections } = await stores();
    return connections.change((data) => {
      const aliases = (data.aliases ??= []);
      const index = aliases.findIndex((item) => item.id === aliasId);
      if (index === -1) throw new LedgerNotFound('Model alias', aliasId);
      const draft = normalizeAliasDraft(body, data, aliasId);
      const updated: ModelAlias = { id: aliasId, ...draft };
      aliases[index] = updated;
      return {
        alias: updated,
        aliases: [...aliases],
        defaultAliasId: data.defaultAliasId ?? null,
      };
    });
  });

  app.delete<AliasParams>('/v1/providers/aliases/:aliasId', RENDERER_ROUTE, async (request) => {
    const aliasId = parse(Identifier, request.params.aliasId);
    const { connections } = await stores();
    return connections.change((data) => {
      const aliases = (data.aliases ??= []);
      const index = aliases.findIndex((item) => item.id === aliasId);
      if (index === -1) throw new LedgerNotFound('Model alias', aliasId);
      aliases.splice(index, 1);
      if (data.defaultAliasId === aliasId) data.defaultAliasId = null;
      return {
        removed: true as const,
        aliasId,
        aliases: [...aliases],
        defaultAliasId: data.defaultAliasId ?? null,
      };
    });
  });
}
