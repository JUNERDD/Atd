import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * What the loopback MCP servers of the tests (mcp-oauth-mock.ts, mcp-sse-server.ts) share: reading
 * JSON bodies, replying, and the answers of the one-tool server they both run.
 */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A JSON object from `text`; anything else, malformed input included, reads as empty. */
export function parseRecord(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

export async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** A JSON reply, or an empty one when `body` is undefined. */
export function reply(res: ServerResponse, status: number, body?: unknown, headers = {}): void {
  const json = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  res.writeHead(status, body === undefined ? headers : { ...json, ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

/**
 * The result of a JSON-RPC request to the one-tool server (initialize, ping, `tools/list`, and
 * `tools/call` of `echo`); undefined means "method not found".
 */
export function echoServerResult(
  method: string,
  params: Record<string, unknown>,
  protocolVersion: unknown = params.protocolVersion,
): unknown {
  const inputSchema = { type: 'object', properties: { text: { type: 'string' } } };
  const echo = { name: 'echo', description: 'Echoes the text back.', inputSchema };
  const args = isRecord(params.arguments) ? params.arguments : {};
  const results: Record<string, unknown> = {
    initialize: {
      protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'loopback-server', version: '1.0.0' },
    },
    ping: {},
    'tools/list': { tools: [echo] },
    'tools/call': { content: [{ type: 'text', text: String(args.text) }] },
  };
  return results[method];
}

/**
 * Follows an authorization URL to the redirect the mock issues. With `visit` it also loads that
 * redirect, which completes a sign-in when the service's loopback callback server is listening;
 * without it `location` is what a user would paste back.
 */
export async function approveAuthorization(
  authorizationUrl: string | URL,
  options: { visit?: boolean } = {},
): Promise<{ location: string; callback?: { status: number; text: string } }> {
  const redirect = await fetch(authorizationUrl, { redirect: 'manual' });
  const location = redirect.headers.get('location');
  if (redirect.status !== 302 || !location) {
    throw new Error(`authorization was refused: ${redirect.status} ${await redirect.text()}`);
  }
  if (!options.visit) return { location };
  const callback = await fetch(location);
  return { location, callback: { status: callback.status, text: await callback.text() } };
}
