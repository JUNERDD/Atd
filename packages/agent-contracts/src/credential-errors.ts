/**
 * Auth failure codes emitted when a saved provider connection has no usable
 * credential at runtime (for example, OS keychain access broke after re-signing
 * or the stored secret is missing). The renderer matches these complete codes to
 * explain the failure in the user's language and link directly to Providers settings.
 */
export const CREDENTIAL_AUTH_ERRORS = ['credential_unreadable', 'credential_missing'] as const;
export type CredentialAuthErrorCode = (typeof CREDENTIAL_AUTH_ERRORS)[number];

/** Matches complete credential-auth error codes in run failure messages. */
export function credentialAuthError(message: string): CredentialAuthErrorCode | undefined {
  return CREDENTIAL_AUTH_ERRORS.find((code) =>
    new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(message),
  );
}
