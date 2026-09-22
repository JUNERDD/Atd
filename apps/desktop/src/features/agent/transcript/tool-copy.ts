import {
  Brain,
  FilePen,
  FilePlus,
  FileText,
  SquareTerminal,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { GrantScope, PermissionOutcome } from '../../../../electron/agent/permission-schema';
import type { BlockOf, ToolStatus } from '../../../../electron/agent/transcript-schema';

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
  | 'activity.step.removeMemory';

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
  | 'permission.scope.mcp';

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
};

export function stepKey(name: string): StepKey | null {
  return STEP_KEYS[name] ?? null;
}

/**
 * Operation-specific label for `command` rows. The tool takes `operation` plus `commandId` /
 * `fields` (see `CommandToolSchema`), so `list` / `get` / `save` read distinctly and a save with
 * a `commandId` is an update while one without is a create. Unknown shapes fall back to the
 * generic manage label.
 */
export function commandStepKey(args: Record<string, unknown>): StepKey {
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
  if (name.startsWith('memory_') && typeof args.target === 'string') return args.target;
  return null;
}

export function bashCommand(args: Record<string, unknown>): string {
  return typeof args.command === 'string' ? args.command : '';
}

/**
 * Whether the row has anything to expand into. ToolBlock renders a static row when this is
 * false so tools without detail expose no hover-expand affordance; ToolBody renders nothing.
 */
export function hasToolDetail(block: BlockOf<'tool'>): boolean {
  const text = block.status === 'running' ? block.partial : block.output;
  switch (block.name) {
    case 'edit':
      return Boolean(block.details.diff || text);
    case 'bash':
      return Boolean(bashCommand(block.args) || text);
    default:
      return Boolean(text || block.status === 'interrupted');
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
