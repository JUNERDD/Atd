import { AgentClientError, authHeaders, type AgentClientOptions } from '@atd/agent-client';
import {
  DoctorRunRequestSchema,
  DoctorRunResponseSchema,
  ErrorEnvelopeSchema,
  parse,
  type DoctorRunRequest,
  type DoctorRunResponse,
} from '@atd/agent-contracts';

/** Calls `POST /v1/diagnostics/run` through the shell relay and validates the sanitized DTO. */
export async function runDoctorChecks(
  options: AgentClientOptions,
  request: DoctorRunRequest = {},
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<DoctorRunResponse> {
  const body = parse(DoctorRunRequestSchema, request);
  const response = await fetchImpl(`${options.baseUrl}/v1/diagnostics/run`, {
    method: 'POST',
    headers: {
      ...authHeaders(options),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    try {
      const envelope = parse(ErrorEnvelopeSchema, json);
      throw new AgentClientError(envelope.error.code, response.status, envelope.error.message);
    } catch (error) {
      if (error instanceof AgentClientError) throw error;
      throw new AgentClientError(
        'internal',
        response.status,
        `Request failed with status ${response.status}.`,
      );
    }
  }
  return parse(DoctorRunResponseSchema, json);
}
