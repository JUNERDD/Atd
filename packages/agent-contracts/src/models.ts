import { Type, type Static } from 'typebox';

/** Pi's model thinking levels, lowest first. */
export const ThinkingLevelSchema = Type.Union([
  Type.Literal('off'),
  Type.Literal('minimal'),
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('xhigh'),
  Type.Literal('max'),
]);
export type ThinkingLevel = Static<typeof ThinkingLevelSchema>;

/**
 * One model definition as the service stores and serves it: catalog entries,
 * a connection's refreshed catalog and caller-defined custom models share this
 * shape. Mirrors the desktop ModelDefinition so callers keep one model contract.
 */
export const ServiceModelDefinitionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
    api: Type.String({ minLength: 1, maxLength: 256 }),
    baseUrl: Type.String({ maxLength: 2048 }),
    reasoning: Type.Boolean(),
    /** An endpoint's declared control, retained separately from the model's reasoning ability. */
    reasoningControl: Type.Optional(
      Type.Union([
        Type.Literal('effort'),
        Type.Literal('budget'),
        Type.Literal('toggle'),
        Type.Literal('fixed'),
      ]),
    ),
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
    /**
     * The level the server or model maker publishes as the model's default, when it publishes
     * one. Runs fall back to it only when neither the request nor the connection names a level.
     */
    defaultThinkingLevel: Type.Optional(ThinkingLevelSchema),
    input: Type.Array(Type.Union([Type.Literal('text'), Type.Literal('image')])),
    contextWindow: Type.Integer({ minimum: 1 }),
    /**
     * The largest window the model takes, when a source names it: the server's published maximum
     * (Ollama's trained length, LM Studio's maximum load) or the window the server or the model
     * maker reports. Bounds the windows a user may choose; absent on a fallback window.
     */
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
export type ServiceModelDefinition = Static<typeof ServiceModelDefinitionSchema>;

/**
 * A model's context window choice where a real trade-off exists: `standard` is the smaller window
 * (or the one below a pricing threshold), `long` the larger one. The service alone derives which
 * windows a model offers.
 */
export const ContextTierSchema = Type.Union([Type.Literal('standard'), Type.Literal('long')]);
export type ContextTier = Static<typeof ContextTierSchema>;

/**
 * A context window the user sets for one model, overriding its catalog window and tiers. The floor
 * leaves room for the compaction reserve; the ceiling is far above any served window.
 */
export const CustomContextWindowSchema = Type.Integer({ minimum: 1024, maximum: 100_000_000 });
