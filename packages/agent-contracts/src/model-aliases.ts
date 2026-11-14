import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';
import {
  ContextTierSchema,
  MAX_CONTEXT_WINDOW,
  MIN_CONTEXT_WINDOW,
  ThinkingLevelSchema,
} from './models.js';

export const MAX_MODEL_ALIASES = 32;
export const MAX_MODEL_ALIAS_NAME_LENGTH = 48;
export const MAX_SEED_MODEL_ALIASES = 8;

const ModelId = Type.String({ minLength: 1, maxLength: 256 });

/** Per-run context window override: either a connection tier or an explicit token count. */
export const RunContextChoiceSchema = Type.Union([
  Type.Object({ tier: ContextTierSchema }, { additionalProperties: false }),
  Type.Object(
    { contextWindow: Type.Integer({ minimum: MIN_CONTEXT_WINDOW, maximum: MAX_CONTEXT_WINDOW }) },
    { additionalProperties: false },
  ),
]);
export type RunContextChoice = Static<typeof RunContextChoiceSchema>;

/** Editable fields of a named model alias before or when saved on the service. */
export const ModelAliasDraftSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: MAX_MODEL_ALIAS_NAME_LENGTH }),
    connectionId: Identifier,
    modelId: ModelId,
    contextChoice: Type.Optional(RunContextChoiceSchema),
    thinkingLevel: Type.Optional(ThinkingLevelSchema),
  },
  { additionalProperties: false },
);
export type ModelAliasDraft = Static<typeof ModelAliasDraftSchema>;

/** A saved named model alias: points at a provider connection model with optional slot defaults. */
export const ModelAliasSchema = Type.Object(
  {
    id: Identifier,
    name: Type.String({ minLength: 1, maxLength: MAX_MODEL_ALIAS_NAME_LENGTH }),
    connectionId: Identifier,
    modelId: ModelId,
    contextChoice: Type.Optional(RunContextChoiceSchema),
    thinkingLevel: Type.Optional(ThinkingLevelSchema),
  },
  { additionalProperties: false },
);
export type ModelAlias = Static<typeof ModelAliasSchema>;

export const ModelAliasCreateRequestSchema = ModelAliasDraftSchema;
export type ModelAliasCreateRequest = Static<typeof ModelAliasCreateRequestSchema>;

export const ModelAliasUpdateRequestSchema = ModelAliasDraftSchema;
export type ModelAliasUpdateRequest = Static<typeof ModelAliasUpdateRequestSchema>;

export const ModelAliasMutationResponseSchema = Type.Object(
  {
    alias: ModelAliasSchema,
    aliases: Type.Array(ModelAliasSchema),
    defaultAliasId: Type.Union([Identifier, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ModelAliasMutationResponse = Static<typeof ModelAliasMutationResponseSchema>;

export const ModelAliasRemoveResponseSchema = Type.Object(
  {
    removed: Type.Literal(true),
    aliasId: Identifier,
    aliases: Type.Array(ModelAliasSchema),
    defaultAliasId: Type.Union([Identifier, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ModelAliasRemoveResponse = Static<typeof ModelAliasRemoveResponseSchema>;

export const ModelAliasDefaultRequestSchema = Type.Object(
  {
    defaultAliasId: Type.Union([Identifier, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ModelAliasDefaultRequest = Static<typeof ModelAliasDefaultRequestSchema>;

export const ModelAliasDefaultResponseSchema = Type.Object(
  {
    defaultAliasId: Type.Union([Identifier, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ModelAliasDefaultResponse = Static<typeof ModelAliasDefaultResponseSchema>;

export const ModelAliasesSeedRequestSchema = Type.Object(
  {
    aliases: Type.Array(ModelAliasDraftSchema, { minItems: 1, maxItems: MAX_SEED_MODEL_ALIASES }),
  },
  { additionalProperties: false },
);
export type ModelAliasesSeedRequest = Static<typeof ModelAliasesSeedRequestSchema>;

export const ModelAliasesSeedResponseSchema = Type.Object(
  {
    aliases: Type.Array(ModelAliasSchema),
    defaultAliasId: Type.Union([Identifier, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ModelAliasesSeedResponse = Static<typeof ModelAliasesSeedResponseSchema>;
