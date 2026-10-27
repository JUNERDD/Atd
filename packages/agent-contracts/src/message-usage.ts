import { Type, type Static } from 'typebox';

/**
 * Provider-reported usage of the assistant message a block came from. Every block projected from
 * one message carries the same copy, so clients dedupe by message (`timestamp`) when summing a
 * turn. `cost` is the total in USD at the model's catalog price, 0 when the catalog has none.
 * Absent while the message streams and on messages without usage.
 */
export const MessageUsageSchema = Type.Object(
  {
    input: Type.Integer({ minimum: 0 }),
    output: Type.Integer({ minimum: 0 }),
    cacheRead: Type.Integer({ minimum: 0 }),
    cacheWrite: Type.Integer({ minimum: 0 }),
    cost: Type.Number({ minimum: 0 }),
    /**
     * How long the provider spent generating `output`, as the service timed the stream (its
     * generation.ts): the token rate divides by it. Absent when the stream could not be timed,
     * including messages that failed or stopped and sessions from before it was measured.
     */
    durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type MessageUsage = Static<typeof MessageUsageSchema>;
