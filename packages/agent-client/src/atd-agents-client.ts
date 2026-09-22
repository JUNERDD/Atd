import type { AgentClientOptions } from './types.js';

export interface AtdAgentWire {
  name: string;
  description: string;
  tools: string[];
  model: string | null;
  systemPrompt: string;
}

async function request<T>(
  options: AgentClientOptions,
  path: string,
  method: string,
  body: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(`${options.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${options.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(`Agent request ${method} ${path} failed with status ${response.status}.`);
  return json as T;
}

/** Lists markdown specialists from ~/.atd/agents. */
export function listAtdAgents(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<{ agents: AtdAgentWire[] }> {
  return request(options, '/v1/agents', 'GET', undefined, fetchImpl);
}

/** Creates or replaces one markdown specialist under ~/.atd/agents. */
export function putAtdAgent(
  options: AgentClientOptions,
  input: {
    name: string;
    description: string;
    tools: string[];
    model: string | null;
    systemPrompt: string;
  },
  fetchImpl?: typeof fetch,
): Promise<{ agent: AtdAgentWire }> {
  const { name, description, tools, model, systemPrompt } = input;
  return request(
    options,
    `/v1/agents/${encodeURIComponent(name)}`,
    'PUT',
    { description, tools, model, systemPrompt },
    fetchImpl,
  );
}
