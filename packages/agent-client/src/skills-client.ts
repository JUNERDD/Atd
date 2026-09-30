import { authHeaders, type AgentClientOptions } from './types.js';

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
  sourceKind: 'local' | 'npm' | 'git' | 'atd' | 'agents' | 'plugin';
  system: boolean;
  /** The plugin that contributes the skill, computed by the service (`user` for Personal). */
  pluginId: string;
  /** Skills of installed and shared plugins cannot be edited, only toggled or duplicated. */
  readOnly: boolean;
  /** Set for a product skill's ATD-home copy; null for every other row. */
  builtin: BuiltinStatusWire | null;
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

/**
 * Status of a builtin resource (a product skill in the ATD home, or the default role) against the
 * version the service ships; `version` is that shipped version.
 */
export interface BuiltinStatusWire {
  id: string;
  version: number;
  status: 'current' | 'modified' | 'update_available';
}

export interface RoleWire {
  id: string;
  revision: string;
  title: string;
  allows: { tools: string[]; skills: string[] };
  updatedAt: string;
  /** Set for the builtin default role; null for every other role. */
  builtin: BuiltinStatusWire | null;
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

/**
 * One catalog skill (null when the name is not in the catalog) with its folder's files as
 * relative paths; `truncated` says the listing was cut off. `skill` mirrors the revision record.
 */
export function getSkill(
  options: AgentClientOptions,
  name: string,
  fetchImpl?: typeof fetch,
): Promise<{ skill: unknown; files: string[]; truncated: boolean }> {
  return request(options, `/v1/skills/${encodeURIComponent(name)}`, 'GET', undefined, fetchImpl);
}

/** One text file of a skill folder; `content` is null with the reason for a binary or large file. */
export function readSkillFile(
  options: AgentClientOptions,
  name: string,
  path: string,
  fetchImpl?: typeof fetch,
): Promise<{ path: string; content: string | null; reason: 'binary' | 'too_large' | null }> {
  const query = `?path=${encodeURIComponent(path)}`;
  return request(
    options,
    `/v1/skills/${encodeURIComponent(name)}/file${query}`,
    'GET',
    undefined,
    fetchImpl,
  );
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

/** Deletes one Personal skill (`~/.atd/skills`); built-in, plugin and shared skills are refused. */
export function deleteSkill(
  options: AgentClientOptions,
  name: string,
  fetchImpl?: typeof fetch,
): Promise<{ name: string; deleted: true }> {
  return request(options, `/v1/skills/${encodeURIComponent(name)}`, 'DELETE', undefined, fetchImpl);
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

/**
 * Restores a builtin resource (`skill:<name>` or `role:default`) to the shipped version. The
 * service backs up a changed copy first; `backupPath` is null when there was nothing to keep.
 */
export function restoreBuiltin(
  options: AgentClientOptions,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<{ id: string; backupPath: string | null; builtin: BuiltinStatusWire }> {
  return request(options, `/v1/builtins/${encodeURIComponent(id)}/restore`, 'POST', {}, fetchImpl);
}
