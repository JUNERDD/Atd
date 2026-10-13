import { ResponseBodyError } from 'openid-client';

const TERMINAL_ERRORS = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);

export const CHATGPT_RECONNECT_NOTICE =
  'ChatGPT authorization is no longer valid. Sign in again to reconnect.';

/** Only a rejected refresh grant can invalidate a stored ChatGPT credential. */
export class ChatGPTRefreshInvalidated extends Error {
  constructor(cause: ResponseBodyError) {
    super(CHATGPT_RECONNECT_NOTICE, { cause });
    this.name = 'ChatGPTRefreshInvalidated';
  }
}

/** Called only for token refresh, never discovery or an authorization-code exchange. */
export function terminalChatGPTRefreshError(error: unknown): ChatGPTRefreshInvalidated | undefined {
  if (
    error instanceof ResponseBodyError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429 &&
    TERMINAL_ERRORS.has(error.error)
  )
    return new ChatGPTRefreshInvalidated(error);
  return undefined;
}

/** Pi wraps refresh failures in ModelsError while preserving the original cause. */
export function isChatGPTRefreshInvalidation(error: unknown): boolean {
  for (let depth = 0; depth < 8 && error instanceof Error; depth++) {
    if (error instanceof ChatGPTRefreshInvalidated) return true;
    error = error.cause;
  }
  return false;
}
