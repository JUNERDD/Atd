import { Type, type Static } from 'typebox';

/** Bump when the data use or background-use disclosure changes materially. */
export const CHATGPT_PRIVACY_VERSION = 1;

export const ChatGPTConsentRequestSchema = Type.Object(
  {
    privacyVersion: Type.Literal(CHATGPT_PRIVACY_VERSION),
    backgroundAllowed: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ChatGPTConsentRequest = Static<typeof ChatGPTConsentRequestSchema>;

/** Older notices remain readable but cannot authorize requests under a newer notice. */
export const ChatGPTConsentSchema = Type.Object(
  {
    privacyVersion: Type.Integer({ minimum: 1 }),
    backgroundAllowed: Type.Boolean(),
    acceptedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
);

export const ProviderLoginRequestSchema = Type.Object(
  {
    enablePlanUsage: Type.Optional(Type.Boolean()),
    language: Type.Optional(Type.Union([Type.Literal('en'), Type.Literal('zh-CN')])),
  },
  { additionalProperties: false },
);
export type ProviderLoginRequest = Static<typeof ProviderLoginRequestSchema>;

export const CHATGPT_USAGE_ERRORS = [
  'subscription_sharing_usage_limit_exceeded',
  'subscription_sharing_usage_unavailable',
  'subscription_sharing_user_not_eligible',
  'subscription_sharing_user_unavailable',
  'subscription_sharing_unsupported_capability',
  'subscription_sharing_route_not_supported',
  'subscription_sharing_invalid_user',
  'chatpass_v2_scope_not_authorized',
  'chatpass_v2_invalid_authorization_context',
  'chatgpt_plan_disabled',
  'chatgpt_privacy_required',
  'chatgpt_background_consent_required',
] as const;
export type ChatGPTUsageError = (typeof CHATGPT_USAGE_ERRORS)[number];

/** Provider streams retain codes in their diagnostic text; match complete codes only. */
export function chatgptUsageError(message: string): ChatGPTUsageError | undefined {
  return CHATGPT_USAGE_ERRORS.find((code) =>
    new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(message),
  );
}
