import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';
import { ChatGPTConsentRequestSchema } from './chatgpt.js';
import { ProviderCredentialSchema, ServiceConnectionSchema } from './provider-connections.js';
import {
  ContextTierSchema,
  CustomContextWindowSchema,
  ServiceModelDefinitionSchema,
  ThinkingLevelSchema,
} from './models.js';

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
    { action: Type.Literal('replace'), credential: ProviderCredentialSchema },
    { additionalProperties: false },
  ),
]);
export type ProviderCredentialChange = Static<typeof ProviderCredentialChangeSchema>;

/** Replaces the editable configuration; provider and authentication method stay fixed. */
export const ProviderUpdateRequestSchema = Type.Object(
  {
    chatgptConsent: Type.Optional(ChatGPTConsentRequestSchema),
    resumeChatGPTUsage: Type.Optional(Type.Literal(true)),
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

/**
 * Pi's selectable levels for the model, lowest first, empty when the model is unknown; and the
 * level it runs at when the connection saves none (`off` for an unknown model).
 */
export const ProviderLevelsResponseSchema = Type.Object(
  { levels: Type.Array(ThinkingLevelSchema, { maxItems: 7 }), defaultLevel: ThinkingLevelSchema },
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
 * The model's context windows. `options` are its tiers, `standard` first; a model without a real
 * tier choice has none and null `defaultTier` / `selected`. `choices` are the other windows the
 * user may pick for it (the service derives them); the picked one is `custom`, which new runs use
 * instead of the tier or catalog window.
 */
export const ProviderContextsResponseSchema = Type.Object(
  {
    options: Type.Array(ProviderContextOptionSchema, { maxItems: 2 }),
    defaultTier: Type.Union([ContextTierSchema, Type.Null()]),
    /** The tier new runs of this model use without a custom window: the saved one, else the default. */
    selected: Type.Union([ContextTierSchema, Type.Null()]),
    /** The model's own window in the connection's catalog; null for an unknown model. */
    catalogWindow: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    /** Windows the user may pick besides the catalog window and tiers, smallest first. */
    choices: Type.Array(CustomContextWindowSchema, { maxItems: 12 }),
    /** The window the user picked for the model; null when none is picked. */
    custom: Type.Union([CustomContextWindowSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ProviderContextsResponse = Static<typeof ProviderContextsResponseSchema>;

const ContextTarget = {
  expectedRevision: Type.Integer({ minimum: 1 }),
  modelId: Type.String({ minLength: 1, maxLength: 256 }),
};

/**
 * Remembers a model's context window on the connection for later runs; revision-guarded, answers
 * with `ProviderConnectionResponse`. A `tier` clears any custom window, and choosing the default
 * tier removes the saved tier. A `contextWindow` picks one of the model's `choices`; null clears it.
 */
export const ProviderContextRequestSchema = Type.Union([
  Type.Object({ ...ContextTarget, tier: ContextTierSchema }, { additionalProperties: false }),
  Type.Object(
    { ...ContextTarget, contextWindow: Type.Union([CustomContextWindowSchema, Type.Null()]) },
    { additionalProperties: false },
  ),
]);
export type ProviderContextRequest = Static<typeof ProviderContextRequestSchema>;
/** What a context write chooses: a tier, or a custom window (null clears it). */
export type ProviderContextChoice =
  | { tier: Static<typeof ContextTierSchema> }
  | { contextWindow: Static<typeof CustomContextWindowSchema> | null };

/** Safe protocol diagnostics only; never include upstream messages, URLs, or token claims. */
export const ProviderLoginDiagnosticSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal('network'),
      Type.Literal('expired'),
      Type.Literal('invalidGrant'),
      Type.Literal('rejected'),
      Type.Literal('unavailable'),
      Type.Literal('invalidResponse'),
      Type.Literal('verification'),
    ]),
    stage: Type.Union([Type.Literal('discovery'), Type.Literal('exchange')]),
    code: Type.String({ maxLength: 100 }),
    field: Type.Optional(Type.String({ maxLength: 32 })),
    status: Type.Optional(Type.Integer({ minimum: 100, maximum: 599 })),
    reason: Type.Optional(
      Type.Union([
        Type.Literal('pkceMismatch'),
        Type.Literal('redirectMismatch'),
        Type.Literal('clientMismatch'),
        Type.Literal('codeUsed'),
        Type.Literal('codeExpired'),
      ]),
    ),
    requestId: Type.Optional(Type.String({ maxLength: 128 })),
  },
  { additionalProperties: false },
);
export type ProviderLoginDiagnostic = Static<typeof ProviderLoginDiagnosticSchema>;

/**
 * Account sign-in progress. The service runs the Pi login flow and keeps its
 * state; the caller polls it while `waiting`, answers `prompt`, and opens
 * `url` itself (the service never opens a browser).
 */
export const ProviderLoginStateSchema = Type.Object(
  {
    chatgptPlanEnabled: Type.Optional(Type.Boolean()),
    diagnostic: Type.Optional(ProviderLoginDiagnosticSchema),
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
