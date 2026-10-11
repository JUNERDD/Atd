import type { ProviderLoginDiagnostic } from '@atd/agent-contracts';
import { LoginFailure } from './login-errors.js';
import { grantFailureReason, oauthRequestId } from './oauth-grant-error.js';

const CODES = new Set([
  'OAUTH_RESPONSE_BODY_ERROR',
  'OAUTH_AUTHORIZATION_RESPONSE_ERROR',
  'OAUTH_INVALID_RESPONSE',
  'OAUTH_INVALID_REQUEST',
  'OAUTH_PARSE_ERROR',
  'OAUTH_RESPONSE_IS_NOT_JSON',
  'OAUTH_RESPONSE_IS_NOT_CONFORM',
  'OAUTH_JWT_CLAIM_COMPARISON_FAILED',
  'OAUTH_JWT_TIMESTAMP_CHECK_FAILED',
  'OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED',
  'OAUTH_KEY_SELECTION_FAILED',
  'OAUTH_UNSUPPORTED_OPERATION',
  'OAUTH_TIMEOUT',
  'OAUTH_ABORT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
]);
const OAUTH_ERRORS = new Set([
  'invalid_grant',
  'invalid_client',
  'invalid_scope',
  'invalid_request',
  'unauthorized_client',
  'unsupported_grant_type',
  'access_denied',
  'server_error',
  'temporarily_unavailable',
]);
const FIELDS = new Set([
  'iss',
  'aud',
  'azp',
  'nonce',
  'sub',
  'exp',
  'iat',
  'nbf',
  'state',
  'auth_time',
  'id_token',
  'access_token',
  'token_type',
  'scope',
  'expires_in',
  'alg',
  'kid',
]);
const MESSAGES = {
  network: 'Could not reach ChatGPT. Check your network and try again.',
  expired: 'This authorization expired. Start a new sign-in.',
  invalidGrant:
    'ChatGPT could not complete this authorization. Keep this connection and sign in again.',
  rejected: 'ChatGPT rejected the sign-in request. See the error details.',
  unavailable: 'ChatGPT sign-in is temporarily unavailable. Try again later.',
  invalidResponse: 'ChatGPT returned an unexpected response. See the error details.',
  verification: 'Could not verify the ChatGPT sign-in. See the error details.',
} satisfies Record<ProviderLoginDiagnostic['kind'], string>;

/** Project a bounded allow-list, never a serialized upstream error or JWT claims. */
function diagnostic(
  stage: ProviderLoginDiagnostic['stage'],
  error: unknown,
): ProviderLoginDiagnostic {
  let current = error;
  let code = 'OAUTH_UNKNOWN';
  let oauthError: string | undefined;
  let field: string | undefined;
  let status: number | undefined;
  let reason: ProviderLoginDiagnostic['reason'];
  let requestId: string | undefined;
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth++) {
    if ('code' in current && typeof current.code === 'string' && CODES.has(current.code))
      code = current.code;
    if ('error' in current && typeof current.error === 'string' && OAUTH_ERRORS.has(current.error))
      oauthError = current.error;
    if (oauthError === 'invalid_grant' && 'error_description' in current)
      reason = grantFailureReason(current.error_description) ?? reason;
    if ('claim' in current && typeof current.claim === 'string' && FIELDS.has(current.claim))
      field = current.claim;
    if (current instanceof Error) {
      const quoted = current.message.match(/"([a-z_]+)"/)?.[1];
      if (quoted && FIELDS.has(quoted)) field = quoted;
      if (current.message === 'JWT signature verification failed') field = 'signature';
    }
    const response =
      current instanceof Response ? current : 'response' in current ? current.response : undefined;
    if (response instanceof Response) {
      status = response.status;
      requestId = oauthRequestId(response) ?? requestId;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  let kind: ProviderLoginDiagnostic['kind'] = 'verification';
  if (oauthError === 'invalid_grant') kind = reason === 'codeExpired' ? 'expired' : 'invalidGrant';
  else if (
    oauthError === 'server_error' ||
    oauthError === 'temporarily_unavailable' ||
    (status && (status >= 500 || status === 429))
  )
    kind = 'unavailable';
  else if (oauthError || (status && status >= 400 && status < 500)) kind = 'rejected';
  else if (
    code === 'OAUTH_TIMEOUT' ||
    /^(E|UND_ERR_)/.test(code) ||
    (error instanceof TypeError && error.message === 'fetch failed')
  )
    kind = 'network';
  else if (
    ['OAUTH_RESPONSE_IS_NOT_JSON', 'OAUTH_RESPONSE_IS_NOT_CONFORM', 'OAUTH_PARSE_ERROR'].includes(
      code,
    )
  )
    kind = 'invalidResponse';
  return {
    kind,
    stage,
    code: oauthError ? `${code}/${oauthError}` : code,
    ...(field ? { field } : {}),
    ...(status ? { status } : {}),
    ...(reason ? { reason } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

export async function oauthOperation<T>(
  stage: ProviderLoginDiagnostic['stage'],
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const details = diagnostic(stage, error);
    throw new LoginFailure(MESSAGES[details.kind], details, { cause: error });
  }
}
