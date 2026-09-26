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

/**
 * Lists the subagent catalog: the service's system agents (`system: true`, read-only), then the
 * markdown specialists from ~/.atd/agents, each with whether later runs may use it.
 */
export function listAtdAgents(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<{ agents: Array<AtdAgentWire & { system: boolean; enabled: boolean }> }> {
  return request(options, '/v1/agents', 'GET', undefined, fetchImpl);
}

/** Turns one catalog agent on or off for later runs; the agent file is not written. */
export function setAtdAgentEnabled(
  options: AgentClientOptions,
  name: string,
  enabled: boolean,
  fetchImpl?: typeof fetch,
): Promise<{ name: string; enabled: boolean }> {
  return request(
    options,
    `/v1/agents/${encodeURIComponent(name)}/enabled`,
    'POST',
    { enabled },
    fetchImpl,
  );
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
