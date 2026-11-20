import { Type, type Static } from 'typebox';

/**
 * Provider-reported allowance for one connection. A provider may report metered windows
 * (such as a five-hour session and a weekly quota), a billing balance, or neither; Atd never
 * derives a percentage the provider did not report.
 */
export const ProviderUsageWindowIdSchema = Type.Union([
  Type.Literal('session'),
  Type.Literal('weekly'),
  Type.Literal('monthly'),
  Type.Literal('monthlyCode'),
]);
export type ProviderUsageWindowId = Static<typeof ProviderUsageWindowIdSchema>;

export const ProviderUsageWindowSchema = Type.Object(
  {
    id: ProviderUsageWindowIdSchema,
    /** Fraction of the window already used, from 0 to 1. */
    usedRatio: Type.Number({ minimum: 0, maximum: 1 }),
    /** When the provider resets this window, as an ISO 8601 timestamp when it reports one. */
    resetsAt: Type.Optional(Type.String({ maxLength: 64 })),
  },
  { additionalProperties: false },
);
export type ProviderUsageWindow = Static<typeof ProviderUsageWindowSchema>;

/** A prepaid balance in the provider's billing currency, in whole currency units. */
export const ProviderUsageBalanceSchema = Type.Object(
  {
    currency: Type.String({ maxLength: 16 }),
    /** Pay-as-you-go accounts in arrears report a negative remaining balance. */
    remaining: Type.Number(),
    total: Type.Optional(Type.Number({ minimum: 0 })),
    monthlyUsed: Type.Optional(Type.Number({ minimum: 0 })),
    monthlyLimit: Type.Optional(Type.Number({ minimum: 0 })),
    monthlyLimitEnabled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type ProviderUsageBalance = Static<typeof ProviderUsageBalanceSchema>;

/**
 * One usage lookup. `unsupported` means the provider publishes no usage API and the UI shows
 * that instead of inventing numbers; `unavailable` means the connection has no API key to use.
 */
export const ProviderUsageResponseSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('ok'),
      windows: Type.Array(ProviderUsageWindowSchema),
      balance: Type.Optional(ProviderUsageBalanceSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal('unsupported') }, { additionalProperties: false }),
  Type.Object(
    {
      kind: Type.Literal('unavailable'),
      reason: Type.Literal('no-credential'),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('error'),
      message: Type.String({ maxLength: 2000 }),
    },
    { additionalProperties: false },
  ),
]);
export type ProviderUsageResponse = Static<typeof ProviderUsageResponseSchema>;
