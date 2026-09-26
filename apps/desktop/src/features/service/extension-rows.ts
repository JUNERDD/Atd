/**
 * Extension catalog rows as the renderer reads them from the service bridge. Wire values arrive
 * as `unknown`, so each parser checks the fields it keeps and drops a row without its key.
 */
export type ExtensionRoleTool = 'read' | 'write' | 'edit' | 'bash' | 'command';

/** Install state of a resource that ships with the app; `modified` copies are never overwritten. */
export interface ExtensionBuiltin {
  id: string;
  status: 'current' | 'modified' | 'update_available';
}

export interface ExtensionSkillRow {
  name: string;
  description: string;
  sourceKind: 'local' | 'npm' | 'git' | 'agents' | 'atd' | '';
  /** Seeded by the service; the row reads as a system skill instead of its folder. */
  system: boolean;
  /** Null for skills that do not ship with the app. */
  builtin: ExtensionBuiltin | null;
  revision: string;
  enabled: boolean;
}

export interface ExtensionRoleRow {
  id: string;
  title: string;
  allows: { tools: ExtensionRoleTool[]; skills: string[] };
}

export interface ExtensionAgentRow {
  name: string;
  /** Registered by the service for every session; read-only. */
  system: boolean;
  description: string;
  tools: ExtensionRoleTool[];
  model: string;
  systemPrompt: string;
  /** Whether later runs register it; a disabled agent is also refused as a reference. */
  enabled: boolean;
}

export interface ExtensionMcpRow {
  serverId: string;
  state: string;
  lastError: string;
  disabled: boolean;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
}

/** What the skill detail adds to a row: where the skill comes from and its folder's files. */
export interface ExtensionSkillDetail {
  source: string;
  baseDir: string;
  license: string;
  capability: { kind: 'text' | 'script'; tools: string[] };
  disableModelInvocation: boolean;
  /** Paths relative to `baseDir`, `/`-separated; an empty folder ends in `/`. */
  files: string[];
  /** The service cut the listing off at its entry or depth limit. */
  truncated: boolean;
}

/** The configured connection behind an MCP status row. Header and env values stay out of view. */
export interface ExtensionMcpConfig {
  serverId: string;
  transport: string;
  command: string;
  args: string[];
  url: string;
  auth: 'none' | 'bearer' | 'oauth' | null;
}

/** The translated source a skill row names; null for a skill without one. */
export function skillSourceLabelKey(
  sourceKind: ExtensionSkillRow['sourceKind'],
):
  | 'extensions.sourceLocal'
  | 'extensions.sourceNpm'
  | 'extensions.sourceGit'
  | 'extensions.sourceAgents'
  | 'extensions.sourceAtd'
  | null {
  switch (sourceKind) {
    case 'local':
      return 'extensions.sourceLocal';
    case 'npm':
      return 'extensions.sourceNpm';
    case 'git':
      return 'extensions.sourceGit';
    case 'agents':
      return 'extensions.sourceAgents';
    case 'atd':
      return 'extensions.sourceAtd';
    case '':
      return null;
    default: {
      const _exhaustive: never = sourceKind;
      return _exhaustive;
    }
  }
}

export const ROLE_TOOLS: ExtensionRoleTool[] = ['read', 'write', 'edit', 'bash', 'command'];

function readString(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null) return '';
  const field = Reflect.get(value, key);
  return typeof field === 'string' ? field : '';
}

function readFlag(value: unknown, key: string): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return Reflect.get(value, key) === true;
}

function readCount(value: unknown, key: string): number {
  if (typeof value !== 'object' || value === null) return 0;
  const field = Reflect.get(value, key);
  return typeof field === 'number' && Number.isInteger(field) && field >= 0 ? field : 0;
}

function readObject(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

function readStrings(value: unknown, key: string): string[] {
  const field = readObject(value, key);
  return Array.isArray(field)
    ? field.filter((item): item is string => typeof item === 'string')
    : [];
}

function readEnabled(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  const field = Reflect.get(value, 'enabled');
  return typeof field === 'boolean' ? field : true;
}

function asSourceKind(value: string): ExtensionSkillRow['sourceKind'] {
  if (value === 'local' || value === 'npm' || value === 'git') return value;
  if (value === 'agents' || value === 'atd') return value;
  return '';
}

function asBuiltin(value: unknown): ExtensionBuiltin | null {
  if (typeof value !== 'object' || value === null) return null;
  const builtin = Reflect.get(value, 'builtin');
  const id = readString(builtin, 'id');
  const status = readString(builtin, 'status');
  if (!id) return null;
  if (status === 'current' || status === 'modified' || status === 'update_available')
    return { id, status };
  return null;
}

function asRoleTool(value: unknown): ExtensionRoleTool | null {
  if (value === 'read' || value === 'write' || value === 'edit') return value;
  if (value === 'bash' || value === 'command') return value;
  return null;
}

function asAllows(value: unknown): ExtensionRoleRow['allows'] {
  if (typeof value !== 'object' || value === null) return { tools: [], skills: [] };
  const toolsRaw = Reflect.get(value, 'tools');
  const skillsRaw = Reflect.get(value, 'skills');
  const tools = Array.isArray(toolsRaw)
    ? toolsRaw.flatMap((tool) => {
        const parsed = asRoleTool(tool);
        return parsed ? [parsed] : [];
      })
    : [];
  const skills = Array.isArray(skillsRaw)
    ? skillsRaw.filter((skill): skill is string => typeof skill === 'string')
    : [];
  return { tools, skills };
}

export function asSkillRow(value: unknown): ExtensionSkillRow | null {
  const name = readString(value, 'name');
  return name
    ? {
        name,
        description: readString(value, 'description'),
        sourceKind: asSourceKind(readString(value, 'sourceKind')),
        system: readFlag(value, 'system'),
        builtin: asBuiltin(value),
        revision: readString(value, 'revision'),
        enabled: readEnabled(value),
      }
    : null;
}

export function asRoleRow(value: unknown): ExtensionRoleRow | null {
  const id = readString(value, 'id');
  if (!id) return null;
  const allows =
    typeof value === 'object' && value !== null ? Reflect.get(value, 'allows') : undefined;
  return { id, title: readString(value, 'title') || id, allows: asAllows(allows) };
}

function asAgentTools(value: unknown): ExtensionRoleTool[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tool) => {
    const parsed = asRoleTool(tool);
    return parsed ? [parsed] : [];
  });
}

export function asAgentRow(value: unknown): ExtensionAgentRow | null {
  const name = readString(value, 'name');
  if (!name) return null;
  const tools =
    typeof value === 'object' && value !== null ? Reflect.get(value, 'tools') : undefined;
  const model = readString(value, 'model');
  return {
    name,
    system: readFlag(value, 'system'),
    description: readString(value, 'description'),
    tools: asAgentTools(tools),
    model,
    systemPrompt: readString(value, 'systemPrompt'),
    enabled: readEnabled(value),
  };
}

export function asMcpRow(value: unknown): ExtensionMcpRow | null {
  const serverId = readString(value, 'serverId');
  return serverId
    ? {
        serverId,
        state: readString(value, 'state'),
        lastError: readString(value, 'lastError'),
        disabled: readFlag(value, 'disabled'),
        toolCount: readCount(value, 'toolCount'),
        resourceCount: readCount(value, 'resourceCount'),
        promptCount: readCount(value, 'promptCount'),
      }
    : null;
}

/** The `skillsGet` answer; null when the skill left the catalog or its record is unreadable. */
export function asSkillDetail(value: {
  skill: unknown;
  files: unknown;
  truncated: unknown;
}): ExtensionSkillDetail | null {
  const { skill } = value;
  if (!readString(skill, 'name')) return null;
  const capability = readObject(skill, 'capability');
  return {
    source: readString(skill, 'source'),
    baseDir: readString(skill, 'baseDir'),
    license: readString(skill, 'license'),
    capability: {
      kind: readString(capability, 'kind') === 'script' ? 'script' : 'text',
      tools: readStrings(capability, 'tools'),
    },
    disableModelInvocation: readFlag(skill, 'disableModelInvocation'),
    files: readStrings(value, 'files'),
    truncated: readFlag(value, 'truncated'),
  };
}

export function asMcpConfig(value: unknown): ExtensionMcpConfig | null {
  const serverId = readString(value, 'serverId');
  if (!serverId) return null;
  const stdio = readObject(value, 'stdio');
  const http = readObject(value, 'http');
  const auth = readString(readObject(http, 'auth'), 'type');
  return {
    serverId,
    transport: readString(value, 'transport'),
    command: readString(stdio, 'command'),
    args: readStrings(stdio, 'args'),
    url: readString(http, 'url'),
    auth: auth === 'none' || auth === 'bearer' || auth === 'oauth' ? auth : null,
  };
}
