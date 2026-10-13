/** App-owned catalog errors are safe to persist and show; upstream bodies may contain credentials. */
export class CatalogFailure extends Error {}

const NETWORK_ERRORS: Record<string, string> = {
  ENOTFOUND: 'The model directory hostname could not be resolved (ENOTFOUND).',
  EAI_AGAIN: 'DNS lookup for the model directory failed temporarily (EAI_AGAIN).',
  ECONNREFUSED: 'The model directory refused the connection (ECONNREFUSED).',
  ECONNRESET: 'The model directory closed the connection (ECONNRESET).',
  ETIMEDOUT: 'The model directory connection timed out (ETIMEDOUT).',
  UND_ERR_CONNECT_TIMEOUT: 'The model directory connection timed out (UND_ERR_CONNECT_TIMEOUT).',
  UND_ERR_HEADERS_TIMEOUT: 'The model directory did not send response headers in time.',
  UND_ERR_BODY_TIMEOUT: 'The model directory response timed out.',
  CERT_HAS_EXPIRED: 'The model directory TLS certificate has expired.',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The model directory TLS certificate is self-signed.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'The model directory TLS certificate could not be verified.',
  ERR_TLS_CERT_ALTNAME_INVALID: 'The model directory TLS certificate does not match its hostname.',
};

/** Keep actionable causes, without copying tokens, response bodies or arbitrary SDK error text. */
export function catalogFailureReason(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current instanceof CatalogFailure) return current.message;
    if (current.name === 'TimeoutError' || current.name === 'AbortError')
      return 'The model directory request timed out or was cancelled.';
    if (current.name === 'KeyringUnavailable')
      return 'The saved credential could not be read. Unlock the system keychain and try again.';
    if ('code' in current && typeof current.code === 'string') {
      const reason = NETWORK_ERRORS[current.code];
      if (reason) return reason;
    }
    // Pi owns this exact message. Preserve its status without forwarding arbitrary upstream text.
    const status = /^Model catalog request failed for [\w-]+: (\d{3})$/.exec(current.message)?.[1];
    if (status) return `The Pi model directory returned HTTP ${status}.`;
    if (current instanceof SyntaxError) return 'The model directory returned invalid JSON.';
    current = current.cause;
  }
  return 'The model directory could not be reached or read. Check the endpoint and network settings.';
}

function httpReason(status: number): string {
  if (status >= 300 && status < 400)
    return 'Redirects are not followed. Set Base URL to the final API endpoint.';
  if (status === 401)
    return 'Authentication was rejected. Check the saved API key or sign in again.';
  if (status === 403) return 'Access was denied. Check the credential permissions.';
  if (status === 404)
    return 'The models endpoint was not found. Check Base URL, including its API path.';
  if (status === 429) return 'The model directory rate limit was reached. Try again later.';
  if (status >= 500) return 'The model directory service failed. Try again later.';
  return 'The model directory rejected the request.';
}

/** Bounded JSON discovery; never forward credentials through an upstream redirect. */
export async function readCatalogJson(
  url: string,
  headers: Record<string, string> = {},
  signal: AbortSignal = AbortSignal.timeout(15000),
): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    redirect: 'manual',
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new CatalogFailure(
      `Model directory returned HTTP ${response.status}. ${httpReason(response.status)}`,
    );
  }
  if (!response.body) throw new CatalogFailure('The model directory returned an empty response.');
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      // Aggregators include descriptions and pricing for thousands of models.
      if (size > 8 * 1024 * 1024)
        throw new CatalogFailure('The model directory response exceeds the 8 MiB limit.');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new CatalogFailure(
      'The model directory returned invalid JSON. Check that Base URL points to an API.',
    );
  }
}
