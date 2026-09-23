import { Type, type Static } from 'typebox';

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
    name: Type.String({ minLength: 1, maxLength: 120 }),
    baseUrl: text,
    authType: AuthTypeSchema,
    defaultModel: Type.String({ maxLength: 256 }),
    /** Thinking level for the connection's default model; runs without an explicit level use it. */
    defaultThinkingLevel: Type.Optional(ModelThinkingLevelSchema),
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
  setModel: (reference: ModelReference, revision: number) => Promise<void>;
  /** Thinking levels Pi accepts for one model, in Pi's order; empty when the model is unknown. */
  levels: (reference: ModelReference) => Promise<ModelThinkingLevel[]>;
  disconnect: (connectionId: string, revision: number) => Promise<void>;
  refresh: (connectionId: string) => Promise<void>;
  verify: (reference: ModelReference) => Promise<void>;
  login: (connectionId: string) => Promise<LoginState>;
  answer: (id: string, promptId: string, value: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  openLink: (id: string) => Promise<void>;
  onLogin: (listener: (state: LoginState) => void) => () => void;
}
