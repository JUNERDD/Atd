import {
  Astroid,
  BrainCircuit,
  Gauge,
  History,
  ListOrdered,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { CommandIds } from './trigger';

/**
 * Quick commands that open a second-level list instead of running at once.
 * The editor reports `trigger.drill` only for these ids (`/model gpt` → drill `model`).
 */
export const DRILL_COMMAND_IDS = ['model', 'effort'] as const;

export type DrillCommandId = (typeof DRILL_COMMAND_IDS)[number];

/** Composer-owned actions that quick commands run after the trigger text is cleared. */
export interface QuickActions {
  newTask: () => void;
  openHistory: () => void;
}

/** Composer-owned actions beyond `QuickActions`; `showQueue` reopens the approval/queue popover. */
export type QuickCommandActions = QuickActions & {
  openSettings: () => void;
  showQueue: () => void;
};

/** What decides whether a command can run for the current draft. */
export interface QuickCommandContext {
  /** A model is selected for this draft or by default. */
  hasModel: boolean;
  /** Effort levels the model offers; `null` while they load. */
  effortLevels: number | null;
  /** Something waits above the composer: an approval, a question, or a queued message. */
  hasPending: boolean;
}

/** Why a command is greyed out; each maps to `quickPanel.blocked.*`. */
export type QuickCommandBlock = 'noModel' | 'noEffort' | 'noPending';

interface CommandBase {
  icon: LucideIcon;
  /** English search terms beyond the id and the localized title. */
  keywords: readonly string[];
  blockedBy?: (context: QuickCommandContext) => QuickCommandBlock | null;
}

/**
 * Renderer-run commands; none is ever sent as text. A drill command replaces the trigger with
 * `/<id> ` so the editor reports its drill list; the others clear the trigger text, then run.
 * Titles and descriptions live at `quickPanel.commands.<id>.*`.
 */
export type QuickCommand =
  | (CommandBase & { kind: 'drill'; id: DrillCommandId })
  | (CommandBase & {
      kind: 'run';
      id: 'new' | 'history' | 'queue' | 'settings';
      run: (actions: QuickCommandActions) => void;
    });

export const QUICK_COMMANDS: readonly QuickCommand[] = [
  {
    kind: 'run',
    id: 'new',
    icon: Astroid,
    keywords: ['chat', 'conversation', 'clear'],
    run: (actions) => actions.newTask(),
  },
  { kind: 'drill', id: 'model', icon: BrainCircuit, keywords: ['provider', 'llm'] },
  {
    kind: 'drill',
    id: 'effort',
    icon: Gauge,
    keywords: ['thinking', 'reasoning'],
    blockedBy: ({ hasModel, effortLevels }) =>
      !hasModel ? 'noModel' : effortLevels !== null && effortLevels < 2 ? 'noEffort' : null,
  },
  {
    kind: 'run',
    id: 'history',
    icon: History,
    keywords: ['tasks', 'conversations'],
    run: (actions) => actions.openHistory(),
  },
  {
    kind: 'run',
    id: 'queue',
    icon: ListOrdered,
    keywords: ['pending', 'waiting', 'approval', 'queued', 'messages'],
    blockedBy: ({ hasPending }) => (hasPending ? null : 'noPending'),
    run: (actions) => actions.showQueue(),
  },
  {
    kind: 'run',
    id: 'settings',
    icon: Settings,
    keywords: ['preferences', 'options'],
    run: (actions) => actions.openSettings(),
  },
];

/** The ids the composer editor recognizes after a leading `/`; it never imports the table above. */
export const QUICK_COMMAND_IDS: CommandIds = {
  all: QUICK_COMMANDS.map((command) => command.id),
  drillable: DRILL_COMMAND_IDS,
};

/** Narrows the editor's reported drill command to a known drill list. */
export function isDrillCommand(command: string): command is DrillCommandId {
  const ids: readonly string[] = DRILL_COMMAND_IDS;
  return ids.includes(command);
}
