import type { ProviderLoginDiagnostic } from '@atd/agent-contracts';

/** Classify only a provider's explicit explanation; never return the untrusted text itself. */
export function grantFailureReason(value: unknown): ProviderLoginDiagnostic['reason'] {
  if (typeof value !== 'string' || value.length > 2000) return undefined;
  if (/\b(?:or|may|might)\b/i.test(value)) return undefined;
  if (
    /(?:pkce|code[_ ]verifier|code[_ ]challenge)/i.test(value) &&
    /mismatch|invalid|failed|missing|does not match/i.test(value)
  )
    return 'pkceMismatch';
  if (/redirect[_ ]uri/i.test(value) && /mismatch|invalid|does not match|incorrect/i.test(value))
    return 'redirectMismatch';
  if (
    /client(?:[_ ]id)?/i.test(value) &&
    /mismatch|does not match|incorrect client|wrong client/i.test(value)
  )
    return 'clientMismatch';
  if (/(?:already|previously) (?:been )?(?:used|redeemed|exchanged)/i.test(value))
    return 'codeUsed';
  // "Invalid or expired" is ambiguous and must not be presented as confirmed expiration.
  if (/^(?:the )?(?:authorization )?code (?:has )?expired[.!]?$/i.test(value.trim()))
    return 'codeExpired';
  return undefined;
}

/** Correlation IDs are safe to share with support; response bodies and headers are not. */
export function oauthRequestId(response: Response): string | undefined {
  const value = response.headers.get('x-request-id');
  return value &&
    /^(?:req_[a-zA-Z0-9_-]+|[0-9a-f]{8}-[0-9a-f-]{27,})$/.test(value) &&
    value.length <= 128
    ? value
    : undefined;
}
