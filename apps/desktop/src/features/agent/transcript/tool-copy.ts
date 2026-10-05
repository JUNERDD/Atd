import {
  AppWindow,
  BookOpen,
  Bot,
  Brain,
  FilePen,
  FilePlus,
  FileSearch,
  FileText,
  FileBox,
  FolderOpen,
  Globe,
  Library,
  Link,
  ListTodo,
  SquareCode,
  SquareTerminal,
  Terminal,
  TextSearch,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  CODEMODE_TOOL,
  LOAD_SKILL_TOOL,
  TODO_TOOL,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
  type AppBuildDetails,
  type ToolBlockDetails,
} from '@atd/agent-contracts';
import type { BlockOf, ToolStatus } from '../../../client/agent/transcript-schema';
import { codemodeTarget } from './codemode-call';
import { subagentStepKey, subagentTarget, type SubagentStepKey } from './subagent-call';

export type StepKey =
  | 'activity.step.read'
  | 'activity.step.write'
  | 'activity.step.edit'
  | 'activity.step.bash'
  | 'activity.step.command'
  | 'activity.step.commandList'
  | 'activity.step.commandGet'
  | 'activity.step.commandCreate'
  | 'activity.step.commandUpdate'
  | 'activity.step.searchMemory'
  | 'activity.step.readMemory'
  | 'activity.step.saveMemory'
  | 'activity.step.updateMemory'
  | 'activity.step.removeMemory'
  | 'activity.step.grep'
  | 'activity.step.find'
  | 'activity.step.ls'
  | 'activity.step.todo'
  | 'activity.step.webSearch'
  | 'activity.step.webFetch'
  | 'activity.step.loadSkill'
  | 'activity.step.codemode'
  | 'activity.step.listMcpResources'
  | 'activity.step.listMcpResourceTemplates'
  | 'activity.step.readMcpResource'
  | 'activity.step.app'
  | 'activity.step.appBuild'
  | SubagentStepKey;

/** The service's MCP resource tools (agent-service `mcp/resource-tools.ts`). */
const LIST_MCP_RESOURCES = 'list_mcp_resources';
const LIST_MCP_RESOURCE_TEMPLATES = 'list_mcp_resource_templates';
const READ_MCP_RESOURCE = 'read_mcp_resource';

export type MemoryTypeKey =
  | 'activity.target.user'
  | 'activity.target.memory'
  | 'activity.target.failure';

const STEP_KEYS: Record<string, StepKey> = {
  read: 'activity.step.read',
  write: 'activity.step.write',
  edit: 'activity.step.edit',
  bash: 'activity.step.bash',
  command: 'activity.step.command',
  memory_search: 'activity.step.searchMemory',
  memory_read: 'activity.step.readMemory',
  memory_add: 'activity.step.saveMemory',
  memory_replace: 'activity.step.updateMemory',
  memory_remove: 'activity.step.removeMemory',
  grep: 'activity.step.grep',
  find: 'activity.step.find',
  ls: 'activity.step.ls',
  [TODO_TOOL]: 'activity.step.todo',
  [WEB_SEARCH_TOOL]: 'activity.step.webSearch',
  [WEB_FETCH_TOOL]: 'activity.step.webFetch',
  [LOAD_SKILL_TOOL]: 'activity.step.loadSkill',
  [CODEMODE_TOOL]: 'activity.step.codemode',
  [LIST_MCP_RESOURCES]: 'activity.step.listMcpResources',
  [LIST_MCP_RESOURCE_TEMPLATES]: 'activity.step.listMcpResourceTemplates',
  [READ_MCP_RESOURCE]: 'activity.step.readMcpResource',
};

const ICONS: Record<string, LucideIcon> = {
  read: FileText,
  write: FilePlus,
  edit: FilePen,
  bash: Terminal,
  command: SquareTerminal,
  memory_search: Brain,
  memory_read: Brain,
  memory_add: Brain,
  memory_replace: Brain,
  memory_remove: Brain,
  subagent: Bot,
  grep: TextSearch,
  find: FileSearch,
  ls: FolderOpen,
  [TODO_TOOL]: ListTodo,
  [WEB_SEARCH_TOOL]: Globe,
  [WEB_FETCH_TOOL]: Link,
  // Same mark as skill chips in the composer and the extension settings.
  [LOAD_SKILL_TOOL]: BookOpen,
  [CODEMODE_TOOL]: SquareCode,
  [LIST_MCP_RESOURCES]: Library,
  [LIST_MCP_RESOURCE_TEMPLATES]: Library,
  [READ_MCP_RESOURCE]: FileBox,
  app: AppWindow,
};

function stepKey(name: string): StepKey | null {
  return STEP_KEYS[name] ?? null;
}

/** Row label for a call: tools whose one name covers several operations read by their args. */
export function toolStepKey(name: string, args: Record<string, unknown>): StepKey | null {
  if (name === 'command') return commandStepKey(args);
  if (name === 'subagent') return subagentStepKey(args);
  // Of the `app` tool's operations only `build` takes a `summary` (the version's change note).
  if (name === 'app')
    return typeof args.summary === 'string' ? 'activity.step.appBuild' : 'activity.step.app';
  return stepKey(name);
}

/**
 * Operation-specific label for `command` rows. The tool takes `operation` plus `commandId` /
 * `fields` (see `CommandToolSchema`), so `list` / `get` / `save` read distinctly and a save with
 * a `commandId` is an update while one without is a create. Unknown shapes fall back to the
 * generic manage label.
 */
function commandStepKey(args: Record<string, unknown>): StepKey {
  const operation = args.operation;
  if (operation === 'list') return 'activity.step.commandList';
  if (operation === 'get') return 'activity.step.commandGet';
  if (operation === 'save') {
    const id = args.commandId;
    return typeof id === 'string' && id
      ? 'activity.step.commandUpdate'
      : 'activity.step.commandCreate';
  }
  return 'activity.step.command';
}

/** Identity of a `command` call: the stored id, or the name being saved on create. */
export function commandTarget(args: Record<string, unknown>): string | null {
  const id = args.commandId;
  if (typeof id === 'string' && id) return id;
  const fields = args.fields;
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    const name = (fields as Record<string, unknown>).name;
    if (typeof name === 'string' && name) return name;
  }
  return null;
}

export function toolIcon(name: string): LucideIcon {
  return ICONS[name] ?? Wrench;
}

/**
 * The type a `memory_add` call without a name saves, which its row shows in place of a target:
 * the service derives the name only when it saves. Every other memory call names its unit or its
 * query, shown as given even when that reads like a type.
 */
export function memoryTypeKey(name: string, args: Record<string, unknown>): MemoryTypeKey | null {
  if (name !== 'memory_add' || stringArg(args.name)) return null;
  switch (args.type) {
    case 'user':
      return 'activity.target.user';
    case 'memory':
      return 'activity.target.memory';
    case 'failure':
      return 'activity.target.failure';
    default:
      return null;
  }
}

export function toolTarget(name: string, args: Record<string, unknown>): string | null {
  if (name === 'read' || name === 'write' || name === 'edit') {
    const path = args.path;
    return typeof path === 'string' ? (path.split('/').pop() ?? path) : null;
  }
  if (name === 'bash') {
    const command = args.command;
    if (typeof command !== 'string') return null;
    return command.split('\n')[0]?.trim() || null;
  }
  if (name === 'command') return commandTarget(args);
  if (name === 'subagent') return subagentTarget(args);
  // A memory tool names its unit and a search shows its query; a create without a name reads by
  // its type instead (`memoryTypeKey`).
  if (name.startsWith('memory_')) return stringArg(args.name) ?? stringArg(args.query);
  if (name === 'grep' || name === 'find') return stringArg(args.pattern);
  if (name === 'ls') {
    const path = stringArg(args.path);
    return path ? (path.split('/').pop() ?? path) : null;
  }
  if (name === TODO_TOOL) return stringArg(args.subject);
  if (name === WEB_SEARCH_TOOL) return stringArg(args.query) ?? firstString(args.queries);
  if (name === WEB_FETCH_TOOL) return stringArg(args.url) ?? firstString(args.urls);
  if (name === LOAD_SKILL_TOOL) return stringArg(args.name);
  if (name === CODEMODE_TOOL) return codemodeTarget(args);
  if (name === LIST_MCP_RESOURCES || name === LIST_MCP_RESOURCE_TEMPLATES)
    return stringArg(args.server);
  if (name === READ_MCP_RESOURCE) return stringArg(args.uri);
  return null;
}

function stringArg(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** First string of a list argument (`queries`, `urls`); the row shows one representative value. */
function firstString(value: unknown): string | null {
  return Array.isArray(value) ? stringArg(value[0]) : null;
}

export function bashCommand(args: Record<string, unknown>): string {
  return typeof args.command === 'string' ? args.command : '';
}

/** Structured details a transcript row renders as its body. */
export type RowDetails = Exclude<
  ToolBlockDetails,
  { type: 'subagent' | 'todo' | 'mcpApproval' | 'app' }
>;

/**
 * The structured body a row renders, if any. A launching `subagent` call's child summaries feed
 * the progress pill's subagent list and the drill-in view, a `todo` call's list feeds the
 * progress pill's Todos view, and a `configure_mcp` approval renders as a banner under its
 * activity group (mcp-approval-banner.tsx), and a published app's card shows under its row at all
 * times (`appDetails`); none renders in the row. A `codemode` call's steps render in its row while
 * it runs too. A `subagent` define call's definitions render in its row and also name what its
 * children ran as (task-agents/task-agents.ts); a define that recorded none (each name already
 * held that definition) reads like any call, by its arguments and result.
 */
export function structuredDetails(block: BlockOf<'tool'>): RowDetails | null {
  const data = block.details.data;
  if (!data) return null;
  switch (data.type) {
    case 'subagent':
    case 'todo':
    case 'mcpApproval':
    case 'app':
      return null;
    case 'subagentDefine':
      return data.agents.length ? data : null;
    case 'codemode':
    case 'diff':
    case 'webFetch':
    case 'webSearch':
      return data;
  }
}

/** The app an `app.build` call published, which its card under the row shows. */
export function appDetails(block: BlockOf<'tool'>): AppBuildDetails | null {
  const data = block.details.data;
  return data?.type === 'app' ? data : null;
}

/**
 * Whether the row has anything to expand into. ToolBlock renders a static row when this is
 * false so tools without detail expose no hover-expand affordance; ToolBody renders nothing.
 * Todo updates stay static: the progress pill's Todos view already shows the current list.
 */
export function hasToolDetail(block: BlockOf<'tool'>): boolean {
  const text = block.status === 'running' ? block.partial : block.output;
  switch (block.name) {
    case TODO_TOOL:
      return false;
    case 'edit':
      return Boolean(block.details.diff || text);
    case 'bash':
      return Boolean(bashCommand(block.args) || text);
    default:
      return Boolean(text || structuredDetails(block) || block.status === 'interrupted');
  }
}

export function statusLabelKey(
  status: ToolStatus,
):
  | 'activity.running'
  | 'activity.completed'
  | 'activity.failed'
  | 'activity.interrupted'
  | 'permission.outcome.declined' {
  switch (status) {
    case 'running':
      return 'activity.running';
    case 'completed':
      return 'activity.completed';
    case 'failed':
      return 'activity.failed';
    case 'interrupted':
      return 'activity.interrupted';
    case 'declined':
      return 'permission.outcome.declined';
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return 'activity.completed';
    }
  }
}
