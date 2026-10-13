import type { ProviderLoginDiagnostic } from '@atd/agent-contracts';

/** Only app-owned messages cross the login boundary; upstream responses may contain secrets. */
export class LoginFailure extends Error {
  constructor(
    message: string,
    readonly diagnostic?: ProviderLoginDiagnostic,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function loginFailureDiagnostic(error: unknown): ProviderLoginDiagnostic | undefined {
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current instanceof LoginFailure && current.diagnostic) return current.diagnostic;
    current = current.cause;
  }
  return undefined;
}

export function hasLoginErrorCode(error: unknown, code: string): boolean {
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if ('code' in current && current.code === code) return true;
    current = current.cause;
  }
  return false;
}

export function loginFailureMessage(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current instanceof LoginFailure) return current.message;
    if (current.name === 'KeyringUnavailable')
      return 'Your credential could not be saved. Unlock the system keychain and sign in again.';
    if ('code' in current && typeof current.code === 'string' && current.code.startsWith('OAUTH_'))
      return 'The sign-in response could not be verified. Start a new sign-in and authorize Atd again.';
    current = current.cause;
  }
  if (hasLoginErrorCode(error, 'EADDRINUSE') || hasLoginErrorCode(error, 'EACCES'))
    return 'The browser callback could not start. Check local network permissions and try again.';
  return 'Sign-in failed or expired. Check your network, then start a new sign-in.';
}
