import { Type, type Static } from 'typebox';
import {
  ChatGPTConsentSchema,
  ChatGPTConsentRequestSchema,
  type ProviderLoginRequest,
  type ProviderLoginDiagnostic,
  type ProviderContextsResponse,
  type ProviderLevelsResponse,
  type ProviderContextChoice,
} from '@atd/agent-contracts';

const text = Type.String({ maxLength: 2048 });
const id = Type.String({ minLength: 1, maxLength: 256 });

/**
 * Pi's model thinking levels, mirrored so a stored preference stays valid without
 * loading the model runtime in the renderer. Keep this union in sync with
 * `ModelThinkingLevel` from `@earendil-works/pi-ai`.
 */
export const ModelThinkingLevelSchema = Type.Union([
  Type.Literal('off'),
  Type.Literal('minimal'),
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('xhigh'),
  Type.Literal('max'),
]);
export type ModelThinkingLevel = Static<typeof ModelThinkingLevelSchema>;

/**
 * A model's context window tier, mirrored from the service contract (`ContextTier`) so the main
 * process validates renderer writes without importing the service schemas.
 */
export const ContextTierSchema = Type.Union([Type.Literal('standard'), Type.Literal('long')]);
export type ContextTier = Static<typeof ContextTierSchema>;
/** The tiers one model offers; no options when the model has no real choice. */
export type ModelContexts = ProviderContextsResponse;
/** A context write: a tier, or a custom window (null clears it). */
export type ModelContextChoice = ProviderContextChoice;
/** The levels one model offers, and the level it runs at when nothing names one. */
export type ModelLevels = ProviderLevelsResponse;

export const ModelDefinitionSchema = Type.Object(
  {
    id,
    name: id,
    api: id,
    baseUrl: text,
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
    defaultThinkingLevel: Type.Optional(ModelThinkingLevelSchema),
    input: Type.Array(Type.Union([Type.Literal('text'), Type.Literal('image')])),
    contextWindow: Type.Integer({ minimum: 1 }),
    maxContextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
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
export type ModelDefinition = Static<typeof ModelDefinitionSchema>;

export const AuthTypeSchema = Type.Union([
  Type.Literal('api_key'),
  Type.Literal('oauth'),
  Type.Literal('none'),
  Type.Literal('ambient'),
]);
export const ConnectionConfigSchema = Type.Object(
  {
    provider: id,
    presetId: Type.Optional(id),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    baseUrl: text,
    authType: AuthTypeSchema,
    defaultModel: Type.String({ maxLength: 256 }),
    /** Thinking level for the connection's default model; runs without an explicit level use it. */
    defaultThinkingLevel: Type.Optional(ModelThinkingLevelSchema),
    /**
     * Context tier per model id, holding only choices that differ from the model's default tier.
     * Written through `ProviderBridge.setContext` only; connection saves never send it.
     */
    contextTiers: Type.Optional(Type.Record(id, ContextTierSchema)),
    /** Custom context window per model id; written through `ProviderBridge.setContext` only. */
    contextWindows: Type.Optional(
      Type.Record(id, Type.Integer({ minimum: 1024, maximum: 100_000_000 })),
    ),
    options: Type.Record(Type.String(), text),
    customModels: Type.Array(ModelDefinitionSchema, { maxItems: 100 }),
  },
  { additionalProperties: false },
);
export type ConnectionConfig = Static<typeof ConnectionConfigSchema>;
export const ConnectionDraftSchema = Type.Object(
  {
    ...ConnectionConfigSchema.properties,
    connectionId: Type.Union([id, Type.Null()]),
    expectedRevision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    apiKey: Type.Optional(Type.String({ maxLength: 8192 })),
    chatgptConsent: Type.Optional(ChatGPTConsentRequestSchema),
    resumeChatGPTUsage: Type.Optional(Type.Literal(true)),
  },
  { additionalProperties: false },
);
export type ConnectionDraft = Static<typeof ConnectionDraftSchema>;
export const StoredConnectionSchema = Type.Object(
  {
    ...ConnectionConfigSchema.properties,
    connectionId: id,
    revision: Type.Integer({ minimum: 1 }),
    connected: Type.Boolean(),
    authNotice: Type.Optional(Type.String({ maxLength: 2000 })),
    accountLabel: Type.Optional(Type.String({ maxLength: 320 })),
    chatgptConsent: Type.Optional(ChatGPTConsentSchema),
    chatgptPlanEnabled: Type.Optional(Type.Boolean()),
    chatgptUsagePaused: Type.Optional(Type.Boolean()),
    encryptedCredential: Type.String({ maxLength: 65536 }),
    catalog: Type.Array(ModelDefinitionSchema),
    catalogError: Type.String(),
    verifiedModel: Type.String(),
  },
  { additionalProperties: false },
);
export type StoredConnection = Static<typeof StoredConnectionSchema>;
export type Connection = Omit<StoredConnection, 'encryptedCredential'> & { hasCredential: boolean };

/** Model metadata is frozen separately from the connection's mutable default preference. */
export const ModelReferenceSchema = Type.Object(
  { connectionId: id, modelId: id },
  { additionalProperties: false },
);
export type ModelReference = Static<typeof ModelReferenceSchema>;
export const FrozenModelSchema = Type.Object(
  {
    ...ModelReferenceSchema.properties,
    provider: id,
    baseUrl: text,
    configurationId: id,
    definition: ModelDefinitionSchema,
  },
  { additionalProperties: false },
);
export type FrozenModel = Static<typeof FrozenModelSchema>;

/** Only main ↔ worker. Never include this in renderer snapshots or task persistence. */
export const ModelAuthSchema = Type.Object({
  auth: Type.Object({
    apiKey: Type.Optional(Type.String()),
    baseUrl: Type.Optional(Type.String()),
    headers: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()]))),
  }),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  source: Type.Optional(Type.String()),
});

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  category: 'accounts' | 'api' | 'cloud' | 'local';
  auth: Array<{ type: ConnectionConfig['authType']; label: string }>;
  baseUrl: string;
  models: ModelDefinition[];
}
export interface LoginState {
  chatgptPlanEnabled?: boolean;
  diagnostic?: ProviderLoginDiagnostic;
  id: string;
  connectionId: string;
  status: 'waiting' | 'complete' | 'cancelled' | 'error';
  message: string;
  url: string;
  code: string;
  prompt: {
    id: string;
    type: 'text' | 'secret' | 'select' | 'manual_code';
    message: string;
    options: Array<{ id: string; label: string }>;
  } | null;
}

export interface ProviderBridge {
  catalog: () => Promise<ProviderCatalogEntry[]>;
  save: (draft: ConnectionDraft) => Promise<Connection>;
  setDefault: (connectionId: string, revision: number) => Promise<void>;
  /**
   * Sets a connection's default model. Its saved thinking level follows, clamped to the model;
   * `thinkingLevel` replaces that level in the same write.
   */
  setModel: (
    reference: ModelReference,
    revision: number,
    thinkingLevel?: ModelThinkingLevel,
  ) => Promise<void>;
  /**
   * Thinking levels Pi accepts for one model, in Pi's order, empty when the model is unknown; and
   * the level the model runs at when neither the run nor the connection names one.
   */
  levels: (reference: ModelReference) => Promise<ModelLevels>;
  /**
   * One model's context windows: its tiers (none when it has no real choice), its catalog window
   * and the custom window the user set.
   */
  contexts: (reference: ModelReference) => Promise<ModelContexts>;
  /**
   * Remembers a model's context window on its connection for later runs: a tier, or a custom
   * window (null clears it); revision-guarded. Both windows may write it: the panel composer's
   * model popover offers the choice too.
   */
  setContext: (
    reference: ModelReference,
    choice: ModelContextChoice,
    revision: number,
  ) => Promise<void>;
  disconnect: (connectionId: string, revision: number) => Promise<void>;
  /**
   * Removes a connection with its credential and model files; revision-guarded. Removing the
   * default leaves no default until the user chooses one.
   */
  remove: (connectionId: string, revision: number) => Promise<string | undefined>;
  refresh: (connectionId: string) => Promise<void>;
  /**
   * A model list opened: background-refreshes connected catalogs that are more than a minute old.
   * Resolves at once; refreshed catalogs arrive with the next settings snapshot, and failures stay
   * silent.
   */
  refreshCatalogs: () => Promise<void>;
  verify: (reference: ModelReference) => Promise<void>;
  login: (connectionId: string, request?: ProviderLoginRequest) => Promise<LoginState>;
  answer: (id: string, promptId: string, value: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  openLink: (id: string) => Promise<void>;
  onLogin: (listener: (state: LoginState) => void) => () => void;
}
