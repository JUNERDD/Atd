import {
  ErrorEnvelopeSchema,
  parse,
  StageReferencesResponseSchema,
  type StageReferencesRequest,
  type StageReferencesResponse,
} from '@ai/agent-contracts';
import { authHeaders, AgentClientError, type AgentClientOptions } from './types.js';

/**
 * Stages composer `@` references for the next run of a task. Like skill and MCP
 * staging, the service consumes the staging once when it freezes that run.
 */
export async function stageReferences(
  options: AgentClientOptions,
  input: StageReferencesRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<StageReferencesResponse> {
  const response = await fetchImpl(`${options.baseUrl}/v1/references/stage`, {
    method: 'POST',
    headers: { ...authHeaders(options), 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) throw toClientError(response.status, json);
  return parse(StageReferencesResponseSchema, json);
}

function toClientError(status: number, json: unknown): AgentClientError {
  try {
    const envelope = parse(ErrorEnvelopeSchema, json);
    return new AgentClientError(envelope.error.code, status, envelope.error.message);
  } catch {
    return new AgentClientError('internal', status, `Request failed with status ${status}.`);
  }
}
