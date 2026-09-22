import type { AgentClientOptions } from './types.js';

/**
 * T3 standalone skill/role client functions. They reuse the base URL/token
 * options and the injected fetch, without editing the existing HTTP/WS
 * clients. Shapes mirror `packages/agent-contracts/src/skills.ts` and
 * `roles.ts` structurally so this file needs no frozen-index export.
 */
export interface SkillListRow {
  name: string;
  revision: string;
  description: string;
  sourceKind: 'local' | 'npm' | 'git' | 'agents';
  disableModelInvocation: boolean;
  enabled: boolean;
  capability: { kind: 'text' | 'script'; tools: string[] };
}

export interface SkillDiagnosticWire {
  type: 'warning' | 'error' | 'collision';
  code: string;
  message: string;
  skill?: string;
  path?: string;
}

export interface SkillExpansionWire {
  isSkillCommand: boolean;
  allowed: boolean;
  skillName: string | null;
  args: string;
  expandPromptTemplates: boolean;
  diagnostics: SkillDiagnosticWire[];
}

export interface RoleWire {
  id: string;
  revision: string;
  title: string;
  allows: { tools: string[]; skills: string[] };
  updatedAt: string;
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
    throw new Error(`Skill request ${method} ${path} failed with status ${response.status}.`);
  return json as T;
}

/** Lists run-available skills; pass runId for the frozen run view. */
export function listSkills(
  options: AgentClientOptions,
  runId?: string,
  fetchImpl?: typeof fetch,
): Promise<{ skills: SkillListRow[]; diagnostics: SkillDiagnosticWire[] }> {
  const query = runId ? `?runId=${encodeURIComponent(runId)}` : '';
  return request(options, `/v1/skills${query}`, 'GET', undefined, fetchImpl);
}

/** Installs a skill from a local/npm/git source (T34int mounts the route). */
export function installSkill(
  options: AgentClientOptions,
  input: { source: string; sourceKind: 'local' | 'npm' | 'git'; name?: string },
  fetchImpl?: typeof fetch,
): Promise<{ skill: unknown; diagnostics: SkillDiagnosticWire[] }> {
  return request(options, '/v1/skills/install', 'POST', input, fetchImpl);
}

/** Records whether this harness may use the skill. Does not write the skill directory. */
export function setSkillEnabled(
  options: AgentClientOptions,
  name: string,
  enabled: boolean,
  fetchImpl?: typeof fetch,
): Promise<{ name: string; enabled: boolean }> {
  return request(
    options,
    `/v1/skills/${encodeURIComponent(name)}/enabled`,
    'POST',
    { enabled },
    fetchImpl,
  );
}

/** Triggers a managed skill update for the named package. */
export function updateSkill(
  options: AgentClientOptions,
  name: string,
  fetchImpl?: typeof fetch,
): Promise<{ skill: unknown; diagnostics: SkillDiagnosticWire[] }> {
  return request(options, `/v1/skills/${encodeURIComponent(name)}/update`, 'POST', {}, fetchImpl);
}

/** Validates an explicit `/skill:name` entry against the frozen run snapshot. */
export function expandSkill(
  options: AgentClientOptions,
  input: { text: string; runId: string },
  fetchImpl?: typeof fetch,
): Promise<SkillExpansionWire> {
  return request(options, '/v1/skills/expand', 'POST', input, fetchImpl);
}

/** Stages skill/role selection for the next run of a task. */
export function stageSkills(
  options: AgentClientOptions,
  input: { taskId: string; skills: { name: string; revision?: string }[]; roleId?: string },
  fetchImpl?: typeof fetch,
): Promise<{ skills: unknown[]; stagedAt: string }> {
  return request(options, '/v1/skills/stage', 'POST', input, fetchImpl);
}

/** Lists managed roles. */
export function listRoles(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<{ roles: RoleWire[] }> {
  return request(options, '/v1/roles', 'GET', undefined, fetchImpl);
}

/** Creates or replaces a managed role; `id` is path-only, not in the body. */
export function putRole(
  options: AgentClientOptions,
  input: {
    id: string;
    title: string;
    allows: {
      tools: Array<'read' | 'write' | 'edit' | 'bash' | 'command'>;
      skills: string[];
    };
  },
  fetchImpl?: typeof fetch,
): Promise<{ role: RoleWire }> {
  const { id, title, allows } = input;
  return request(
    options,
    `/v1/roles/${encodeURIComponent(id)}`,
    'PUT',
    { title, allows },
    fetchImpl,
  );
}
