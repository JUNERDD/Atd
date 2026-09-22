import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';
import { MigrationCredentialSchema, ServiceConnectionSchema } from './migration.js';

/**
 * T6b (service v1.2 candidate): live provider management DTOs. Every response
 * is secret-free metadata from the service ConnectionStore; secrets travel
 * only through the connect body into the OS keyring, never back out.
 */

/** Secret-free connection list with the current default. */
export const ProvidersListResponseSchema = Type.Object(
  {
    defaultConnectionId: Type.Union([Identifier, Type.Null()]),
    connections: Type.Array(ServiceConnectionSchema),
  },
  { additionalProperties: false },
);
export type ProvidersListResponse = Static<typeof ProvidersListResponseSchema>;

/** One secret-free connection. */
export const ProviderGetResponseSchema = Type.Object(
  {
    connection: ServiceConnectionSchema,
  },
  { additionalProperties: false },
);
export type ProviderGetResponse = Static<typeof ProviderGetResponseSchema>;

/** Local-only health: keyring probe + credential-resolution check, no network. */
export const ProviderStatusResponseSchema = Type.Object(
  {
    connection: ServiceConnectionSchema,
    keyring: Type.Object(
      {
        available: Type.Boolean(),
        backend: Type.Union([
          Type.Literal('keychain'),
          Type.Literal('credential-manager'),
          Type.Literal('secret-service'),
          Type.Literal('unavailable'),
        ]),
        detail: Type.String({ maxLength: 2000 }),
      },
      { additionalProperties: false },
    ),
    modelCheck: Type.Union([
      Type.Literal('unchecked'),
      Type.Literal('passed'),
      Type.Literal('failed'),
    ]),
    detail: Type.String({ maxLength: 2000 }),
  },
  { additionalProperties: false },
);
export type ProviderStatusResponse = Static<typeof ProviderStatusResponseSchema>;

/**
 * Live connect: same binding as the migration credential upload (connection
 * + provider + configurationId + credential). Rejects when the connection
 * configuration changed since the caller read it.
 */
export const ProviderConnectRequestSchema = Type.Object(
  {
    connectionId: Identifier,
    providerId: Type.String({ minLength: 1, maxLength: 256 }),
    configurationId: Type.String({ minLength: 1, maxLength: 256 }),
    credential: MigrationCredentialSchema,
  },
  { additionalProperties: false },
);
export type ProviderConnectRequest = Static<typeof ProviderConnectRequestSchema>;

/** Connect outcome: updated metadata plus the local model-check verdict. */
export const ProviderConnectResponseSchema = Type.Object(
  {
    connection: ServiceConnectionSchema,
    readable: Type.Boolean(),
    modelCheck: Type.Union([
      Type.Literal('unchecked'),
      Type.Literal('passed'),
      Type.Literal('failed'),
    ]),
  },
  { additionalProperties: false },
);
export type ProviderConnectResponse = Static<typeof ProviderConnectResponseSchema>;

/** Revision-guarded disconnect; deletes the keyring entry, clears the flags. */
export const ProviderDisconnectRequestSchema = Type.Object(
  {
    expectedRevision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type ProviderDisconnectRequest = Static<typeof ProviderDisconnectRequestSchema>;

export const ProviderDisconnectResponseSchema = Type.Object(
  {
    connection: ServiceConnectionSchema,
  },
  { additionalProperties: false },
);
export type ProviderDisconnectResponse = Static<typeof ProviderDisconnectResponseSchema>;

/**
 * Service-owned provider catalog (v1, frozen): Pi providers plus local
 * entries. Mirrors the desktop ModelDefinition shape so callers keep one
 * model contract; secrets never appear here.
 */
export const ServiceModelDefinitionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
    api: Type.String({ minLength: 1, maxLength: 256 }),
    baseUrl: Type.String({ maxLength: 2048 }),
    reasoning: Type.Boolean(),
    thinkingLevelMap: Type.Optional(
      Type.Object({
        off: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        minimal: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        low: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        medium: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        high: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        xhigh: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        max: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      }),
    ),
    input: Type.Array(Type.Union([Type.Literal('text'), Type.Literal('image')])),
    contextWindow: Type.Integer({ minimum: 1 }),
    maxTokens: Type.Integer({ minimum: 1 }),
    cost: Type.Object({
      input: Type.Number(),
      output: Type.Number(),
      cacheRead: Type.Number(),
      cacheWrite: Type.Number(),
      tiers: Type.Optional(
        Type.Array(
          Type.Object({
            inputTokensAbove: Type.Number(),
            input: Type.Number(),
            output: Type.Number(),
            cacheRead: Type.Number(),
            cacheWrite: Type.Number(),
          }),
        ),
      ),
    }),
  },
  { additionalProperties: false },
);
export type ServiceModelDefinition = Static<typeof ServiceModelDefinitionSchema>;

export const ServiceCatalogEntrySchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
    category: Type.Union([
      Type.Literal('accounts'),
      Type.Literal('api'),
      Type.Literal('cloud'),
      Type.Literal('local'),
    ]),
    auth: Type.Array(
      Type.Object(
        {
          type: Type.Union([
            Type.Literal('api_key'),
            Type.Literal('oauth'),
            Type.Literal('none'),
            Type.Literal('ambient'),
          ]),
          label: Type.String({ minLength: 1, maxLength: 256 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 10 },
    ),
    baseUrl: Type.String({ maxLength: 2048 }),
    models: Type.Array(ServiceModelDefinitionSchema),
  },
  { additionalProperties: false },
);
export type ServiceCatalogEntry = Static<typeof ServiceCatalogEntrySchema>;

/** GET /v1/providers/catalog response: never empty, locals always present. */
export const ProvidersCatalogResponseSchema = Type.Object(
  {
    catalog: Type.Array(ServiceCatalogEntrySchema),
  },
  { additionalProperties: false },
);
export type ProvidersCatalogResponse = Static<typeof ProvidersCatalogResponseSchema>;
