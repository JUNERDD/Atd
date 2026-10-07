import path from 'node:path';
import { Type, type Static } from 'typebox';
import {
  AUTOMATION_RUN_HISTORY,
  AutomationNoticeSchema,
  AutomationPauseReasonSchema,
  AutomationRunSchema,
  AutomationSchema,
  MAX_AUTOMATION_NOTICES,
  MAX_AUTOMATIONS,
  type AutomationRun,
} from '@atd/agent-contracts';

/**
 * The persisted shapes of the automations directory (`<dataDir>/automations`, decision D9). The
 * definitions and the engine's bookkeeping live in separate files, so engine writes never rewrite
 * what a person or the agent authored, and a broken state file never costs the definitions. Folder
 * snapshots live in `folders/<automationId>.json` (folder-snapshots.ts).
 */

/** Trigger fires one automation may make within a rolling hour (decision D6). */
export const AUTOMATION_FIRES_PER_HOUR = 12;

export function automationsDir(dataDir: string): string {
  return path.join(dataDir, 'automations');
}

export function definitionsFile(dataDir: string): string {
  return path.join(automationsDir(dataDir), 'automations.json');
}

export function stateFile(dataDir: string): string {
  return path.join(automationsDir(dataDir), 'state.json');
}

/** `automations.json`: the definitions and the global pause; only saves and auto-pauses write it. */
export const AutomationsFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    /** Bumped on every write of the file. */
    revision: Type.Integer({ minimum: 0 }),
    /** Nothing fires while it is on (`PATCH /v1/automation-settings`). */
    paused: Type.Boolean(),
    automations: Type.Array(AutomationSchema, { maxItems: MAX_AUTOMATIONS }),
  },
  { additionalProperties: false },
);
export type AutomationsFile = Static<typeof AutomationsFileSchema>;

/** What the engine keeps per automation. */
export const AutomationStateSchema = Type.Object(
  {
    /**
     * The schedule occurrence the engine serves next (ISO). Occurrences up to it are served:
     * fired, or recorded as skipped. Absent for triggers that are not schedules and for a one-time
     * schedule whose occurrence was served.
     */
    nextDueAt: Type.Optional(Type.String()),
    /** Interval schedules count from here: the automation's last run, or when it was turned on. */
    anchor: Type.Optional(Type.String()),
    /** Failed and timed-out runs in a row; three turn the automation off (decision D7). */
    consecutiveFailures: Type.Integer({ minimum: 0 }),
    /** Why the service turned the automation off; cleared when it is turned on again. */
    pausedReason: Type.Optional(AutomationPauseReasonSchema),
    /** When the trigger fired within the last hour, oldest first (the rate limit). */
    recentFires: Type.Array(Type.String(), { maxItems: AUTOMATION_FIRES_PER_HOUR }),
    /** Run records, newest first. */
    runs: Type.Array(AutomationRunSchema, { maxItems: AUTOMATION_RUN_HISTORY }),
  },
  { additionalProperties: false },
);
export type AutomationState = Static<typeof AutomationStateSchema>;

/** `state.json`: engine bookkeeping by automation id, and the notices the shell has not posted. */
export const AutomationStateFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    automations: Type.Record(Type.String(), AutomationStateSchema),
    /** Oldest first. */
    notices: Type.Array(AutomationNoticeSchema, { maxItems: MAX_AUTOMATION_NOTICES }),
  },
  { additionalProperties: false },
);
export type AutomationStateFile = Static<typeof AutomationStateFileSchema>;

export function emptyDefinitions(): AutomationsFile {
  return { version: 1, revision: 0, paused: false, automations: [] };
}

export function emptyState(): AutomationStateFile {
  return { version: 1, automations: {}, notices: [] };
}

export function emptyAutomationState(): AutomationState {
  return { consecutiveFailures: 0, recentFires: [], runs: [] };
}

/** Adds a run record as the newest, dropping the oldest beyond the history bound. */
export function pushRun(state: AutomationState, run: AutomationRun): void {
  state.runs = [run, ...state.runs].slice(0, AUTOMATION_RUN_HISTORY);
}

/** Replaces the stored record with the same id; a record no longer kept is left alone. */
export function replaceRun(state: AutomationState, run: AutomationRun): void {
  const index = state.runs.findIndex((item) => item.id === run.id);
  if (index >= 0) state.runs[index] = run;
}
