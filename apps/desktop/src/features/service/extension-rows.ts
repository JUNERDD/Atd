import {
  SubagentPermissionsSchema,
  parse,
  type McpLaunchApprovalState,
  type SubagentPermissions,
} from '@ai/agent-contracts';
import { readCount, readEnabled, readFlag, readString } from './wire-read';

/**
 * Extension catalog rows as the renderer reads them from the service bridge. Wire values arrive
 * as `unknown`, so each parser checks the fields it keeps and drops a row without its key.
 *
 * Every skill, subagent and MCP row names the plugin that contributes it (`pluginId`, computed by
 * the service; empty when a service does not report one, so the row joins no plugin) and whether
 * it is `readOnly`: items of installed and shared plugins can be toggled or duplicated to Personal,
 * not edited.
 */
export type ExtensionRoleTool = 'read' | 'write' | 'edit' | 'bash' | 'command';

/** Install state of a resource that ships with the app; `modified` copies are never overwritten. */
export interface ExtensionBuiltin {
  id: string;
  status: 'current' | 'modified' | 'update_available';
}

/** Which plugin contributes a row, and whether that makes the row read-only. */
export interface ExtensionPluginRef {
  pluginId: string;
  readOnly: boolean;
}

export interface ExtensionSkillRow extends ExtensionPluginRef {
  name: string;
  description: string;
  sourceKind: 'local' | 'npm' | 'git' | 'agents' | 'atd' | 'plugin' | '';
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

export interface ExtensionAgentRow extends ExtensionPluginRef {
  name: string;
  /** Registered by the service for every session; read-only. */
  system: boolean;
  description: string;
  /**
   * What later runs give it: its own tools (null inherits the task's) and approval (null keeps
   * the task's tier). Either way it never exceeds the task's own permissions.
   */
  permissions: SubagentPermissions;
  /** Whether a Settings override replaces its defaults; Restore removes it. */
  customized: boolean;
  /**
   * Its own permissions from its definition or file, which Restore brings back. For a markdown
   * agent, `defaults.tools` is the file's `tools` list (null when the file names none).
   */
  defaults: SubagentPermissions;
  model: string;
  systemPrompt: string;
  /** Whether later runs register it; a disabled agent is also refused as a reference. */
  enabled: boolean;
}

export interface ExtensionMcpRow extends ExtensionPluginRef {
  serverId: string;
  state: string;
  lastError: string;
  disabled: boolean;
  /** Its launch approval; `notRequired` also for a service that reports none. */
  approval: McpLaunchApprovalState;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
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
  | 'extensions.sourcePlugin'
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
    case 'plugin':
      return 'extensions.sourcePlugin';
    case '':
      return null;
    default: {
      const _exhaustive: never = sourceKind;
      return _exhaustive;
    }
  }
}

export const ROLE_TOOLS: ExtensionRoleTool[] = ['read', 'write', 'edit', 'bash', 'command'];

function asSourceKind(value: string): ExtensionSkillRow['sourceKind'] {
  if (value === 'local' || value === 'npm' || value === 'git') return value;
  if (value === 'agents' || value === 'atd' || value === 'plugin') return value;
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

function asApproval(value: string): McpLaunchApprovalState {
  if (value === 'required' || value === 'changed' || value === 'approved') return value;
  return 'notRequired';
}

function asPluginRef(value: unknown): ExtensionPluginRef {
  return { pluginId: readString(value, 'pluginId'), readOnly: readFlag(value, 'readOnly') };
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
        ...asPluginRef(value),
      }
    : null;
}

/**
 * Whether the service lists the skill `name` switched off in Extensions. A create-with-AI session
 * seeded with a switched-off skill's chip would load nothing, so its callers refuse to start.
 */
export async function isSkillDisabled(name: string): Promise<boolean> {
  const listed = await window.desktop?.service?.skills();
  const skill = listed?.skills
    .flatMap((row) => asSkillRow(row) ?? [])
    .find((row) => row.name === name);
  return skill ? !skill.enabled : false;
}

export function asRoleRow(value: unknown): ExtensionRoleRow | null {
  const id = readString(value, 'id');
  if (!id) return null;
  const allows =
    typeof value === 'object' && value !== null ? Reflect.get(value, 'allows') : undefined;
  return { id, title: readString(value, 'title') || id, allows: asAllows(allows) };
}

/**
 * A catalog row; one without a name, or with permissions or defaults outside the contract, is
 * dropped.
 */
export function asAgentRow(value: unknown): ExtensionAgentRow | null {
  const name = readString(value, 'name');
  if (!name || typeof value !== 'object' || value === null) return null;
  let permissions: SubagentPermissions;
  let defaults: SubagentPermissions;
  try {
    permissions = parse(SubagentPermissionsSchema, Reflect.get(value, 'permissions'));
    defaults = parse(SubagentPermissionsSchema, Reflect.get(value, 'defaults'));
  } catch {
    return null;
  }
  const model = readString(value, 'model');
  return {
    name,
    system: readFlag(value, 'system'),
    description: readString(value, 'description'),
    permissions,
    customized: readFlag(value, 'customized'),
    defaults,
    model,
    systemPrompt: readString(value, 'systemPrompt'),
    enabled: readEnabled(value),
    ...asPluginRef(value),
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
        approval: asApproval(readString(value, 'approval')),
        toolCount: readCount(value, 'toolCount'),
        resourceCount: readCount(value, 'resourceCount'),
        promptCount: readCount(value, 'promptCount'),
        ...asPluginRef(value),
      }
    : null;
}
