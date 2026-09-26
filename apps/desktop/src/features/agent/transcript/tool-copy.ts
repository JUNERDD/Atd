import {
  Bot,
  Brain,
  FilePen,
  FilePlus,
  FileSearch,
  FileText,
  FolderOpen,
  Globe,
  Link,
  ListTodo,
  SquareTerminal,
  Terminal,
  TextSearch,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  TODO_TOOL,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
  type GrantScope,
  type ToolBlockDetails,
} from '@ai/agent-contracts';
import type { PermissionOutcome } from '../../../../electron/agent/permission-schema';
import type { BlockOf, ToolStatus } from '../../../../electron/agent/transcript-schema';
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
  | 'activity.step.saveMemory'
  | 'activity.step.updateMemory'
  | 'activity.step.removeMemory'
  | 'activity.step.grep'
  | 'activity.step.find'
  | 'activity.step.ls'
  | 'activity.step.todo'
  | 'activity.step.webSearch'
  | 'activity.step.webFetch'
  | SubagentStepKey;

export type MemoryTargetKey =
  | 'activity.target.user'
  | 'activity.target.project'
  | 'activity.target.memory'
  | 'activity.target.failure';

export type OutcomeKey =
  | 'permission.outcome.once'
  | 'permission.outcome.session'
  | 'permission.outcome.grant'
  | 'permission.outcome.tier'
  | 'permission.outcome.declined';

export type ScopeKey =
  | 'permission.scope.read.inside'
  | 'permission.scope.read.outside'
  | 'permission.scope.write.inside'
  | 'permission.scope.write.outside'
  | 'permission.scope.edit.inside'
  | 'permission.scope.edit.outside'
  | 'permission.scope.bash'
  | 'permission.scope.command'
  | 'permission.scope.mcp'
  | 'permission.scope.web';

const STEP_KEYS: Record<string, StepKey> = {
  read: 'activity.step.read',
  write: 'activity.step.write',
  edit: 'activity.step.edit',
  bash: 'activity.step.bash',
  command: 'activity.step.command',
  memory_search: 'activity.step.searchMemory',
  memory_add: 'activity.step.saveMemory',
  memory_replace: 'activity.step.updateMemory',
  memory_remove: 'activity.step.removeMemory',
  grep: 'activity.step.grep',
  find: 'activity.step.find',
  ls: 'activity.step.ls',
  [TODO_TOOL]: 'activity.step.todo',
  [WEB_SEARCH_TOOL]: 'activity.step.webSearch',
  [WEB_FETCH_TOOL]: 'activity.step.webFetch',
};

const MEMORY_TARGETS: Record<string, MemoryTargetKey> = {
  user: 'activity.target.user',
  project: 'activity.target.project',
  memory: 'activity.target.memory',
  failure: 'activity.target.failure',
};

const ICONS: Record<string, LucideIcon> = {
  read: FileText,
  write: FilePlus,
  edit: FilePen,
  bash: Terminal,
  command: SquareTerminal,
  memory_search: Brain,
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
};

function stepKey(name: string): StepKey | null {
  return STEP_KEYS[name] ?? null;
}

/** Row label for a call: tools whose one name covers several operations read by their args. */
export function toolStepKey(name: string, args: Record<string, unknown>): StepKey | null {
  if (name === 'command') return commandStepKey(args);
  if (name === 'subagent') return subagentStepKey(args);
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

export function memoryTargetKey(target: string): MemoryTargetKey | null {
  return MEMORY_TARGETS[target] ?? null;
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
  if (name.startsWith('memory_') && typeof args.target === 'string') return args.target;
  if (name === 'grep' || name === 'find') return stringArg(args.pattern);
  if (name === 'ls') {
    const path = stringArg(args.path);
    return path ? (path.split('/').pop() ?? path) : null;
  }
  if (name === TODO_TOOL) return stringArg(args.subject);
  if (name === WEB_SEARCH_TOOL) return stringArg(args.query) ?? firstString(args.queries);
  if (name === WEB_FETCH_TOOL) return stringArg(args.url) ?? firstString(args.urls);
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
export type RowDetails = Exclude<ToolBlockDetails, { type: 'subagent' | 'todo' }>;

/**
 * The structured body a row renders, if any. A launching `subagent` call's child summaries feed
 * the progress pill's subagent list and the drill-in view, and a `todo` call's list feeds the
 * progress pill's Todos view; neither renders in the message.
 */
export function structuredDetails(block: BlockOf<'tool'>): RowDetails | null {
  const data = block.details.data;
  return !data || data.type === 'subagent' || data.type === 'todo' ? null : data;
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

export function outcomeKey(outcome: PermissionOutcome): OutcomeKey {
  switch (outcome) {
    case 'once':
      return 'permission.outcome.once';
    case 'session':
      return 'permission.outcome.session';
    case 'grant':
      return 'permission.outcome.grant';
    case 'tier':
      return 'permission.outcome.tier';
    case 'declined':
      return 'permission.outcome.declined';
    default: {
      const _exhaustive: never = outcome;
      void _exhaustive;
      return 'permission.outcome.declined';
    }
  }
}

export function scopeKey(scope: GrantScope): ScopeKey {
  switch (scope.tool) {
    case 'read':
    case 'write':
    case 'edit':
      return `permission.scope.${scope.tool}.${scope.location}`;
    case 'bash':
      return 'permission.scope.bash';
    case 'command':
      return 'permission.scope.command';
    case 'mcp':
      return 'permission.scope.mcp';
    case 'web':
      return 'permission.scope.web';
    default: {
      const _exhaustive: never = scope;
      void _exhaustive;
      return 'permission.scope.command';
    }
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
