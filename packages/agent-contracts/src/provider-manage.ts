import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';
import { MigrationCredentialSchema, ServiceConnectionSchema } from './migration.js';
import { ContextTierSchema, ServiceModelDefinitionSchema, ThinkingLevelSchema } from './models.js';

/**
 * Provider connection edits, preference writes, catalog refresh, model
 * verification and account sign-in. Writes are revision-guarded against the
 * connection the caller last read; responses stay secret-free.
 */

/**
 * What an edit does with the stored secret. `keep` is refused when an API-key
 * connection changes its endpoint, so a saved key is never sent somewhere new
 * without the user entering it again.
 */
export const ProviderCredentialChangeSchema = Type.Union([
  Type.Object({ action: Type.Literal('keep') }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('remove') }, { additionalProperties: false }),
  Type.Object(
    { action: Type.Literal('replace'), credential: MigrationCredentialSchema },
    { additionalProperties: false },
  ),
]);
export type ProviderCredentialChange = Static<typeof ProviderCredentialChangeSchema>;

/** Replaces the editable configuration; provider and authentication method stay fixed. */
export const ProviderUpdateRequestSchema = Type.Object(
  {
    expectedRevision: Type.Integer({ minimum: 1 }),
    name: ServiceConnectionSchema.properties.name,
    baseUrl: ServiceConnectionSchema.properties.baseUrl,
    defaultModel: ServiceConnectionSchema.properties.defaultModel,
    /** Absent clears the saved level, so runs fall back to off. */
    defaultThinkingLevel: ServiceConnectionSchema.properties.defaultThinkingLevel,
    options: Type.Record(Type.String(), Type.String({ maxLength: 2048 })),
    customModels: Type.Array(ServiceModelDefinitionSchema, { maxItems: 100 }),
    credential: ProviderCredentialChangeSchema,
  },
  { additionalProperties: false },
);
export type ProviderUpdateRequest = Static<typeof ProviderUpdateRequestSchema>;

/** One connection after an edit, preference write, refresh or verification. */
export const ProviderConnectionResponseSchema = Type.Object(
  { connection: ServiceConnectionSchema },
  { additionalProperties: false },
);
export type ProviderConnectionResponse = Static<typeof ProviderConnectionResponseSchema>;

/** Makes a connected connection with an available default model the default. */
export const ProviderDefaultRequestSchema = Type.Object(
  { expectedRevision: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export type ProviderDefaultRequest = Static<typeof ProviderDefaultRequestSchema>;

export const ProviderDefaultResponseSchema = Type.Object(
  { defaultConnectionId: Identifier },
  { additionalProperties: false },
);
export type ProviderDefaultResponse = Static<typeof ProviderDefaultResponseSchema>;

/**
 * Sets the default model; it must be in the connection's catalog. The saved thinking level follows
 * it, clamped to what the model supports; `thinkingLevel` replaces that level in the same write.
 */
export const ProviderModelRequestSchema = Type.Object(
  {
    expectedRevision: Type.Integer({ minimum: 1 }),
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
    thinkingLevel: Type.Optional(ThinkingLevelSchema),
  },
  { additionalProperties: false },
);
export type ProviderModelRequest = Static<typeof ProviderModelRequestSchema>;

/**
 * Reloads a connection's model catalog. A manual refresh fetches now and
 * records why it failed on the connection. A background refresh keeps Pi's
 * per-provider freshness window, honors `PI_OFFLINE` and leaves the connection
 * untouched when it fails, so an implicit retry never shows an error row.
 */
export const ProviderRefreshRequestSchema = Type.Object(
  { background: Type.Boolean() },
  { additionalProperties: false },
);
export type ProviderRefreshRequest = Static<typeof ProviderRefreshRequestSchema>;

/** Sends one small billable request to prove the model answers with this credential. */
export const ProviderVerifyRequestSchema = Type.Object(
  { modelId: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false },
);
export type ProviderVerifyRequest = Static<typeof ProviderVerifyRequestSchema>;

/** Query for the thinking levels one of the connection's models accepts. */
export const ProviderLevelsQuerySchema = Type.Object(
  { modelId: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false },
);
export type ProviderLevelsQuery = Static<typeof ProviderLevelsQuerySchema>;

/** Pi's selectable levels for the model, lowest first; empty when the model is unknown. */
export const ProviderLevelsResponseSchema = Type.Object(
  { levels: Type.Array(ThinkingLevelSchema, { maxItems: 7 }) },
  { additionalProperties: false },
);
export type ProviderLevelsResponse = Static<typeof ProviderLevelsResponseSchema>;

/** Query for the context window tiers one of the connection's models offers. */
export const ProviderContextsQuerySchema = Type.Object(
  { modelId: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false },
);
export type ProviderContextsQuery = Static<typeof ProviderContextsQuerySchema>;

/** One selectable context window of a model. */
export const ProviderContextOptionSchema = Type.Object(
  {
    tier: ContextTierSchema,
    contextWindow: Type.Integer({ minimum: 1 }),
    /**
     * Input tokens above which the whole request is billed at the model's higher rate; set only
     * on the `long` tier of a model whose catalog prices such a threshold.
     */
    pricedAbove: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ProviderContextOption = Static<typeof ProviderContextOptionSchema>;

/**
 * The model's context tiers, `standard` first. A model without a real choice has no options and
 * null `defaultTier` / `selected`, and its Context row stays read-only.
 */
export const ProviderContextsResponseSchema = Type.Object(
  {
    options: Type.Array(ProviderContextOptionSchema, { maxItems: 2 }),
    defaultTier: Type.Union([ContextTierSchema, Type.Null()]),
    /** The tier new runs of this model use: the saved choice, else `defaultTier`. */
    selected: Type.Union([ContextTierSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ProviderContextsResponse = Static<typeof ProviderContextsResponseSchema>;

/**
 * Remembers a model's context tier on the connection for later runs; choosing the model's default
 * tier removes the saved entry. Revision-guarded; answers with `ProviderConnectionResponse`.
 */
export const ProviderContextRequestSchema = Type.Object(
  {
    expectedRevision: Type.Integer({ minimum: 1 }),
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
    tier: ContextTierSchema,
  },
  { additionalProperties: false },
);
export type ProviderContextRequest = Static<typeof ProviderContextRequestSchema>;

/**
 * Account sign-in progress. The service runs the Pi login flow and keeps its
 * state; the caller polls it while `waiting`, answers `prompt`, and opens
 * `url` itself (the service never opens a browser).
 */
export const ProviderLoginStateSchema = Type.Object(
  {
    id: Identifier,
    connectionId: Identifier,
    status: Type.Union([
      Type.Literal('waiting'),
      Type.Literal('complete'),
      Type.Literal('cancelled'),
      Type.Literal('error'),
    ]),
    message: Type.String({ maxLength: 2000 }),
    url: Type.String({ maxLength: 8192 }),
    code: Type.String({ maxLength: 256 }),
    prompt: Type.Union([
      Type.Object(
        {
          id: Identifier,
          type: Type.Union([
            Type.Literal('text'),
            Type.Literal('secret'),
            Type.Literal('select'),
            Type.Literal('manual_code'),
          ]),
          message: Type.String({ maxLength: 2000 }),
          options: Type.Array(
            Type.Object(
              {
                id: Type.String({ maxLength: 256 }),
                label: Type.String({ maxLength: 256 }),
              },
              { additionalProperties: false },
            ),
            { maxItems: 100 },
          ),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export type ProviderLoginState = Static<typeof ProviderLoginStateSchema>;

export const ProviderLoginResponseSchema = Type.Object(
  { login: ProviderLoginStateSchema },
  { additionalProperties: false },
);
export type ProviderLoginResponse = Static<typeof ProviderLoginResponseSchema>;

export const ProviderLoginAnswerRequestSchema = Type.Object(
  { promptId: Identifier, value: Type.String({ maxLength: 16384 }) },
  { additionalProperties: false },
);
export type ProviderLoginAnswerRequest = Static<typeof ProviderLoginAnswerRequestSchema>;
