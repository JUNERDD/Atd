import type { SubagentPermissions } from '@atd/agent-contracts';
import { toClientError } from './manage-request.js';
import { authHeaders, type AgentClientOptions } from './types.js';

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
      ...authHeaders(options),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json: unknown = await response.json().catch(() => null);
  // The service's error envelope says why, e.g. a save that would replace another agent.
  if (!response.ok) throw toClientError(response.status, json);
  return json as T;
}

/** The permissions later runs give one catalog agent, and whether Settings changed them. */
export interface AgentPermissionsWire {
  name: string;
  permissions: SubagentPermissions;
  customized: boolean;
}

/** One catalog row: the agent, its enablement, and the permissions later runs use. */
export interface AtdAgentCatalogWire extends Omit<AtdAgentWire, 'tools'> {
  /** The plugin that contributes the agent, computed by the service (`user` for Personal). */
  pluginId: string;
  /** Agents of installed plugins cannot be edited; their permissions can still be overridden. */
  readOnly: boolean;
  enabled: boolean;
  permissions: SubagentPermissions;
  customized: boolean;
  /** Its own permissions from its definition or file, which Restore brings back. */
  defaults: SubagentPermissions;
}

/** A ~/.atd/agents file the catalog skipped, and why; the agent it names is unavailable. */
export interface AtdAgentDiagnosticWire {
  type: 'warning';
  code: 'invalid_agent';
  message: string;
  /** The name the file would load under: its frontmatter name, else its file name. */
  agent: string;
  path: string;
}

/**
 * Lists the subagent catalog: the markdown specialists from ~/.atd/agents, then installed plugins'
 * subagents (read-only), each with whether later runs may use it and with what permissions, and
 * the ~/.atd/agents files that did not load.
 */
export function listAtdAgents(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<{ agents: AtdAgentCatalogWire[]; diagnostics: AtdAgentDiagnosticWire[] }> {
  return request(options, '/v1/agents', 'GET', undefined, fetchImpl);
}

/**
 * Saves one catalog agent's permissions for later runs, or with null restores its defaults. An
 * override equal to the defaults is not kept.
 */
export function setAtdAgentPermissions(
  options: AgentClientOptions,
  name: string,
  permissions: SubagentPermissions | null,
  fetchImpl?: typeof fetch,
): Promise<AgentPermissionsWire> {
  const path = `/v1/agents/${encodeURIComponent(name)}/permissions`;
  return permissions
    ? request(options, path, 'PUT', permissions, fetchImpl)
    : request(options, path, 'DELETE', undefined, fetchImpl);
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

/** Deletes one markdown specialist from ~/.atd/agents; plugin agents are refused. */
export function deleteAtdAgent(
  options: AgentClientOptions,
  name: string,
  fetchImpl?: typeof fetch,
): Promise<{ name: string; deleted: true }> {
  return request(options, `/v1/agents/${encodeURIComponent(name)}`, 'DELETE', undefined, fetchImpl);
}
