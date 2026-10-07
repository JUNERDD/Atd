import type { RunPolicy } from './run-policy';
import { Type, type Static } from 'typebox';
import {
  AutomationDraftSchema,
  Identifier,
  type CompactRefusal,
  type ContextBreakdown,
  type MemoryCreateRequest,
  type MemoryProblem,
  type MemoryProposal,
  type MemorySaveRequest,
  type MemorySettingsRequest,
  type MemoryUnit,
  type TaskContextState,
} from '@atd/agent-contracts';
import type { CommandDefinition } from './command-schema';
import type { AgentTask, Artifact, FileRef, RunSnapshot, TaskInput } from './task-schema';
import type { PermissionAnswer, PermissionRequest, PermissionTier } from './permission-schema';
import type { AgentRequestSchema } from './request-schema';
import type { Block, ChildTranscriptPatch, QueueState, TranscriptPatch } from './transcript-schema';
import { parse } from './validation';
import type { SaveContent } from '../../native-bridge/calls';

/**
 * Memory as Settings, Personal's Memory tab and the `@` panel show it: every unit in Settings order
 * (a turned-off one stays listed, editable and deletable, but runs cannot read, search, learn from
 * or reference it), the learner's pending proposals, unit files the service could not read, and
 * the learning settings. `error` says why the last read failed, or that the service is not
 * connected; it is empty after a read that answered.
 */
export interface MemorySnapshot {
  units: MemoryUnit[];
  proposals: MemoryProposal[];
  problems: MemoryProblem[];
  paused: boolean;
  askFirst: boolean;
  error: string;
}
/** What a unit write answers: the unit as saved, and the snapshot that lists it. */
export interface MemoryUnitWrite {
  unit: MemoryUnit;
  snapshot: MemorySnapshot;
}
/** What accepting a proposal answers: the Personal skill a skill proposal created, if any. */
export interface MemoryProposalAccepted {
  skill: string | null;
  snapshot: MemorySnapshot;
}
/**
 * Everything about a task except its transcript. Published whole whenever run status, pending
 * requests or the queue change; the transcript travels separately as patches so status updates
 * stay small on long conversations.
 */
export interface TaskState {
  task: AgentTask;
  artifacts: Artifact[];
  /** Every pending request of the task's active run, oldest first. */
  requests: PermissionRequest[];
  queue: QueueState;
  /** Context usage and compaction state from the service snapshot and `context.update` events. */
  context: TaskContextState;
}
/** The state plus the current transcript snapshot; returned by `detail` and used to (re)seed a consumer. */
export interface TaskDetail extends TaskState {
  revision: number;
  blocks: Block[];
  /** T6 additive: pending desktop capabilities for waiting-desktop surfacing. */
  capabilities?: {
    id: string;
    capability: string;
    runId: string;
    executionId: string;
    expiresAt: string;
  }[];
}
/** A child session's transcript as the renderer first receives it; patches continue from `revision`. */
export interface ChildTranscriptDetail {
  taskId: string;
  childKey: string;
  revision: number;
  /** The child still runs, so `childTranscript` patches will follow. */
  live: boolean;
  blocks: Block[];
}
export interface AgentSnapshot {
  revision: number;
  connectionId: string;
  commands: CommandDefinition[];
  tasks: AgentTask[];
  shortcutErrors: Record<string, string>;
  error: string;
}
export interface AgentNotice {
  taskId: string;
  text: string;
  kind: 'info' | 'warning' | 'error';
}
export type AgentEvent =
  | { type: 'snapshot'; snapshot: AgentSnapshot }
  | { type: 'task'; state: TaskState }
  | { type: 'transcript'; patch: TranscriptPatch }
  | { type: 'childTranscript'; patch: ChildTranscriptPatch }
  | { type: 'memory'; snapshot: MemorySnapshot }
  | { type: 'notice'; notice: AgentNotice };

/** A request to the agent request handler; `AgentRequestSchema` (`request-schema.ts`) defines it. */
export type AgentRequest = Static<typeof AgentRequestSchema>;
export type SubmitRequest = Extract<AgentRequest, { action: 'submit' }>;
export interface PreparedCommand {
  command: CommandDefinition;
  input: TaskInput;
  notice: string;
}
export interface CommandLaunch {
  prepared: PreparedCommand;
  /** Global shortcut presses run without a review step once the input can be used as-is. */
  autoRun: boolean;
}
/** Hands the command editor off to a new panel session; a null id means "create a command". */
export interface CommandSession {
  commandId: string | null;
  name: string;
}

/**
 * Hands the automation editor off to a new panel session: the saved automation an edit session
 * updates, which the seeded prompt names by name and id, or null to create one. It is validated
 * where it crosses between windows.
 */
export const AutomationSessionTargetSchema = Type.Union([
  Type.Object(
    { id: Identifier, name: AutomationDraftSchema.properties.name },
    { additionalProperties: false },
  ),
  Type.Null(),
]);
export type AutomationSessionTarget = Static<typeof AutomationSessionTargetSchema>;

/**
 * Hands create- or edit-with-AI off to a new panel session seeded with an app skill: Extensions
 * creates or edits a skill, subagent, or MCP server; Memory saves or updates a memory.
 */
export const ExtensionSessionKindSchema = Type.Union([
  Type.Literal('skill'),
  Type.Literal('subagent'),
  Type.Literal('mcp'),
  Type.Literal('memory'),
]);
export type ExtensionSessionKind = Static<typeof ExtensionSessionKindSchema>;
/**
 * The existing item an edit session updates: a skill or subagent name, or an MCP serverId. It is
 * quoted into the seeded prompt, so it must be one trimmed line. Null starts a create session.
 */
export const ExtensionSessionTargetSchema = Type.Union([
  Type.String({ minLength: 1, maxLength: 128, pattern: '^\\S(?:.*\\S)?$' }),
  Type.Null(),
]);
export interface ExtensionSession {
  kind: ExtensionSessionKind;
  target: string | null;
}

/**
 * Validates an extension session request at a process or tab boundary. Memory has no edit target
 * (its skill saves or updates memories from the conversation), so a memory target is rejected
 * rather than silently dropped.
 */
export function parseExtensionSession(kind: unknown, target: unknown): ExtensionSession {
  const session = {
    kind: parse(ExtensionSessionKindSchema, kind),
    target: parse(ExtensionSessionTargetSchema, target),
  };
  if (session.kind === 'memory' && session.target !== null)
    throw new TypeError('Memory sessions do not take an edit target');
  return session;
}

export interface AgentBridge {
  get: () => Promise<AgentSnapshot>;
  detail: (taskId: string) => Promise<TaskDetail>;
  saveCommand: (command: CommandDefinition, expectedRevision: number) => Promise<CommandDefinition>;
  deleteCommand: (commandId: string, revision: number) => Promise<void>;
  launch: (commandId: string, prepared?: { input: TaskInput; revision: number }) => Promise<void>;
  /**
   * Prepares a command on text the page holds (a passage selected in a conversation's answers, or
   * a turn's answer), which stands in for the selection the command reads; the clipboard and a
   * screenshot are captured as a command shortcut press captures them, failures becoming the
   * notice. The caller runs it at once when it can be used as-is (`runsAsIs`), else shows its
   * input step. Rejects when `text` is over the capture limit.
   */
  prepareWithText: (commandId: string, text: string) => Promise<PreparedCommand>;
  prepare: (commandId: string) => Promise<PreparedCommand>;
  capture: (source: 'selection' | 'clipboard') => Promise<{ text: string; capturedAt: string }>;
  preview: (
    input: TaskInput,
    command: CommandDefinition | null,
    policy?: RunPolicy | null,
  ) => Promise<RunSnapshot>;
  submit: (request: Omit<SubmitRequest, 'action'>) => Promise<TaskDetail>;
  /** Stops the run; resolves with the queued messages Stop withdrew, never delivered. */
  stop: (taskId: string, runId: string) => Promise<QueueState>;
  answer: (
    taskId: string,
    runId: string,
    requestId: string,
    answer: PermissionAnswer,
  ) => Promise<void>;
  /** Mid-run input on the active run's Pi session; rejects when the task has no active run. */
  queueMessage: (taskId: string, text: string, mode: 'followUp' | 'steer') => Promise<void>;
  /** Replaces the pending follow-up list (edit / remove); steering messages are not editable. */
  replaceQueue: (taskId: string, followUp: string[]) => Promise<void>;
  setPermissionTier: (taskId: string, tier: PermissionTier) => Promise<void>;
  renameTask: (taskId: string, title: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  /**
   * Compacts an idle task's context now. Resolves to null once the service accepts; progress and
   * the outcome arrive as the task's `compaction` block and context state. A refusal (a run is
   * active, nothing to compact) resolves to its code; other failures reject.
   */
  compactTask: (taskId: string, instructions?: string) => Promise<CompactRefusal | null>;
  /** What fills the task's context, by category; the service computes it on each request. */
  contextBreakdown: (taskId: string) => Promise<ContextBreakdown>;
  /** Copies the task up to the turn `entryId` starts into a new task; resolves with its id. */
  forkTask: (taskId: string, entryId: string, title?: string) => Promise<{ taskId: string }>;
  chooseFiles: () => Promise<FileRef[]>;
  /** Offers `content` under the suggested `name` in a save panel; false when cancelled. */
  saveFile: (name: string, content: SaveContent) => Promise<boolean>;
  /** Reads memory; a failed read, or no connection, is reported in the snapshot's `error`. */
  memory: () => Promise<MemorySnapshot>;
  /**
   * Pauses or resumes learning, or turns Ask before saving on or off. Each memory write below
   * resolves after the snapshot it produced has been published as a `memory` event.
   */
  saveMemorySettings: (settings: MemorySettingsRequest) => Promise<MemorySnapshot>;
  /** Creates a unit written in Settings; a missing name is derived from the description. */
  createMemoryUnit: (input: MemoryCreateRequest) => Promise<MemoryUnitWrite>;
  /**
   * Saves the given fields of one unit. Rejects with the service's message when `revision` is
   * stale (the unit changed since it was read) or a field is refused, such as a taken name.
   */
  saveMemoryUnit: (input: MemorySaveRequest) => Promise<MemoryUnitWrite>;
  /** Moves one unit to the memory trash. */
  deleteMemoryUnit: (id: string) => Promise<MemorySnapshot>;
  /** Turns one unit on or off for runs. */
  toggleMemoryUnit: (id: string, enabled: boolean) => Promise<MemorySnapshot>;
  /** Clears a learned unit's New badge once it has been opened. */
  markMemoryUnitReviewed: (id: string) => Promise<MemorySnapshot>;
  /** Applies one proposal; a skill proposal creates that Personal skill and names it. */
  acceptMemoryProposal: (id: string) => Promise<MemoryProposalAccepted>;
  /** Drops one proposal without applying it. */
  dismissMemoryProposal: (id: string) => Promise<MemorySnapshot>;
  artifact: (
    artifactId: string,
    operation: 'open' | 'reveal' | 'copy' | 'locate' | 'attach',
  ) => Promise<FileRef | null>;
  copy: (text: string) => Promise<void>;
  openLink: (url: string) => Promise<void>;
  /**
   * Subscribes this window to one child's transcript and returns its current state; while held,
   * `childTranscript` events carry its patches. Pair every call with `releaseChildTranscript`.
   */
  childTranscript: (taskId: string, childKey: string) => Promise<ChildTranscriptDetail>;
  releaseChildTranscript: (taskId: string, childKey: string) => Promise<void>;
  onChange: (listener: (event: AgentEvent) => void) => () => void;
  onLaunch: (listener: (launch: CommandLaunch) => void) => () => void;
  onCommandSession: (listener: (session: CommandSession) => void) => () => void;
  onAutomationSession: (listener: (automation: AutomationSessionTarget) => void) => () => void;
  onExtensionSession: (listener: (session: ExtensionSession) => void) => () => void;
}
