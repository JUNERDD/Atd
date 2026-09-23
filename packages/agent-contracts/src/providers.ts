import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';
import { MigrationCredentialSchema, ServiceConnectionSchema } from './migration.js';
import { ServiceModelDefinitionSchema } from './models.js';

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
 * entries. Secrets never appear here.
 */
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

/**
 * Creates one connection from the settings catalog. The service owns the
 * connectionId, revision and configurationId, so the request carries only the
 * configuration the caller chose. The credential travels in the same request
 * because create and connect are one step: a connection never exists without
 * the secret it was created for. `credential: null` saves it disconnected —
 * an API-key connection without a key yet, or an account-login connection
 * that receives its credential from sign-in.
 *
 * `options` and `customModels` are stored with the connection and hashed into
 * its configurationId, the same identity the migration importer computes.
 */
export const ProviderCreateRequestSchema = Type.Object(
  {
    provider: ServiceConnectionSchema.properties.provider,
    name: ServiceConnectionSchema.properties.name,
    baseUrl: ServiceConnectionSchema.properties.baseUrl,
    authType: ServiceConnectionSchema.properties.authType,
    defaultModel: ServiceConnectionSchema.properties.defaultModel,
    defaultThinkingLevel: ServiceConnectionSchema.properties.defaultThinkingLevel,
    options: Type.Record(Type.String(), Type.String({ maxLength: 2048 })),
    customModels: Type.Array(ServiceModelDefinitionSchema, { maxItems: 100 }),
    credential: Type.Union([MigrationCredentialSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ProviderCreateRequest = Static<typeof ProviderCreateRequestSchema>;
