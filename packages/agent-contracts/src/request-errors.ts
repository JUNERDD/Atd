/**
 * How a provider or a gateway in front of it reports a request body it refused for its size
 * (HTTP 413): Anthropic's `request_too_large`, the status itself as provider SDKs prefix it, the
 * status phrases, and the body-limit texts of common gateways (axum's "length limit exceeded",
 * nginx's "Request Entity Too Large"). OpenAI's "Request too large for <model> … tokens per min"
 * is a rate limit and deliberately matches none of these.
 */
const REQUEST_TOO_LARGE_PATTERNS = [
  /request_too_large/i,
  /(?:^|\b(?:status(?:\s*code)?|http|error(?:\s*code)?)\s*:?\s*)413\b/i,
  /payload too large/i,
  /content too large/i,
  /request entity too large/i,
  /length limit exceeded/i,
];

/**
 * Whether a model request failed because its body was too large to accept. The service shrinks
 * the images it sends and retries such a request; the renderer explains the failure in the
 * user's language when the retry fails too.
 */
export function isRequestTooLarge(error: string): boolean {
  return REQUEST_TOO_LARGE_PATTERNS.some((pattern) => pattern.test(error));
}
