import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';
import { ContextTierSchema, ServiceModelDefinitionSchema, ThinkingLevelSchema } from './models.js';

/**
 * Provider connections as the service persists them: the secret-free metadata
 * in `connections.json` and the credential payload kept in the OS keyring.
 * `migratedAt` stays in the stored shape so data written by the 0.2.x desktop
 * import still loads; new connections record it as null.
 */

/**
 * Secret a provider connection stores in the OS keyring. It travels only in
 * create, connect and edit request bodies, never in a response.
 */
export const ProviderCredentialSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal('api_key'),
      key: Type.Optional(Type.String({ maxLength: 8192 })),
      env: Type.Optional(Type.Record(Type.String(), Type.String({ maxLength: 2048 }))),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('oauth'),
      access: Type.String({ maxLength: 8192 }),
      refresh: Type.String({ maxLength: 8192 }),
      expires: Type.Number(),
    },
    { additionalProperties: false },
  ),
]);
export type ProviderCredential = Static<typeof ProviderCredentialSchema>;

/** Metadata the service persists per provider connection; never a secret. */
export const ServiceConnectionSchema = Type.Object(
  {
    connectionId: Identifier,
    provider: Type.String({ minLength: 1, maxLength: 256 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    baseUrl: Type.String({ maxLength: 2048 }),
    authType: Type.Union([
      Type.Literal('api_key'),
      Type.Literal('oauth'),
      Type.Literal('none'),
      Type.Literal('ambient'),
    ]),
    defaultModel: Type.String({ maxLength: 256 }),
    revision: Type.Integer({ minimum: 1 }),
    connected: Type.Boolean(),
    hasCredential: Type.Boolean(),
    configurationId: Type.String({ minLength: 1, maxLength: 256 }),
    verifiedModel: Type.String({ maxLength: 256 }),
    migratedAt: Type.Union([Type.String(), Type.Null()]),
    /*
     * The fields below are optional because records written before the service
     * owned connection editing lack them; absent means none. Responses always
     * carry them, filled by the service.
     */
    /** Non-secret provider options such as a region or deployment map. */
    options: Type.Optional(Type.Record(Type.String(), Type.String({ maxLength: 2048 }))),
    /** Caller-defined models for custom endpoints. */
    customModels: Type.Optional(Type.Array(ServiceModelDefinitionSchema, { maxItems: 100 })),
    /** Last successful catalog refresh; absent until one succeeds for this configuration. */
    catalog: Type.Optional(Type.Array(ServiceModelDefinitionSchema, { maxItems: 10000 })),
    /** Why the last manual refresh failed; cleared by the next success. */
    catalogError: Type.Optional(Type.String({ maxLength: 2000 })),
    /** Level for runs on this connection that name none; absent means off. */
    defaultThinkingLevel: Type.Optional(ThinkingLevelSchema),
    /**
     * Context window tier per model id, holding only choices that differ from the model's default
     * tier; absent (or a missing model id) means the default.
     */
    contextTiers: Type.Optional(
      Type.Record(Type.String(), ContextTierSchema, {
        maxProperties: 10000,
        // Record key schemas are not validated; bound the model ids here.
        propertyNames: { minLength: 1, maxLength: 256 },
      }),
    ),
  },
  { additionalProperties: false },
);
export type ServiceConnection = Static<typeof ServiceConnectionSchema>;

export const ServiceConnectionsFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    defaultConnectionId: Type.Union([Identifier, Type.Null()]),
    connections: Type.Array(ServiceConnectionSchema, { maxItems: 100 }),
  },
  { additionalProperties: false },
);
export type ServiceConnectionsFile = Static<typeof ServiceConnectionsFileSchema>;
