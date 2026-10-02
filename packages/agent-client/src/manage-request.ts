import { ErrorEnvelopeSchema, parse } from '@ai/agent-contracts';
import { authHeaders, AgentClientError, type AgentClientOptions } from './types.js';

/**
 * Shared JSON transport for the T6b standalone management clients. Internal
 * (not exported from the package index); domain modules own their shapes.
 */
export async function manageRequest<T>(
  options: AgentClientOptions,
  path: string,
  method: string,
  body: unknown,
  decode: (json: unknown) => T,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(`${options.baseUrl}${path}`, {
    method,
    headers: {
      ...authHeaders(options),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) throw toClientError(response.status, json);
  return decode(json);
}

/** Reads the download filename, preferring the RFC 5987 encoded form. */
export function dispositionName(header: string | null): string {
  if (!header) return 'download.bin';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall through to the quoted form below.
    }
  }
  return /filename="([^"]+)"/.exec(header)?.[1] ?? 'download.bin';
}

export function toClientError(status: number, json: unknown): AgentClientError {
  try {
    const envelope = parse(ErrorEnvelopeSchema, json);
    return new AgentClientError(envelope.error.code, status, envelope.error.message);
  } catch {
    return new AgentClientError('internal', status, `Request failed with status ${status}.`);
  }
}
