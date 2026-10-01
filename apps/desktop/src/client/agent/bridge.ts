import { RunPolicySchema, type RunPolicy } from './run-policy';
import { Type, type Static } from 'typebox';
import {
  SessionEntryId,
  type CompactRefusal,
  type ContextBreakdown,
  type TaskContextState,
} from '@ai/agent-contracts';
import { CommandSchema, Identifier, type CommandDefinition } from './command-schema';
import {
  InputSchema,
  type AgentTask,
  type Artifact,
  type FileRef,
  type RunSnapshot,
  type TaskInput,
} from './task-schema';
import {
  PermissionAnswerSchema,
  PermissionTierSchema,
  type PermissionAnswer,
  type PermissionRequest,
  type PermissionTier,
} from './permission-schema';
import {
  ChildKeySchema,
  type Block,
  type ChildTranscriptPatch,
  type QueueState,
  type TranscriptPatch,
} from './transcript-schema';
import { parse } from './validation';

export const MemoryEntrySchema = Type.Object(
  {
    id: Identifier,
    target: Type.Union([Type.Literal('memory'), Type.Literal('user'), Type.Literal('failure')]),
    content: Type.String({ minLength: 1, maxLength: 20000 }),
  },
  { additionalProperties: false },
);
export type MemoryEntry = Static<typeof MemoryEntrySchema>;
export interface MemorySnapshot {
  entries: MemoryEntry[];
  paused: boolean;
  error: string;
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

export const AgentRequestSchema = Type.Union([
  Type.Object({ action: Type.Literal('get') }),
  Type.Object({ action: Type.Literal('detail'), taskId: Identifier }),
  Type.Object({
    action: Type.Literal('saveCommand'),
    command: CommandSchema,
    expectedRevision: Type.Integer({ minimum: 0 }),
  }),
  Type.Object({
    action: Type.Literal('deleteCommand'),
    commandId: Identifier,
    revision: Type.Integer({ minimum: 1 }),
  }),
  Type.Object({ action: Type.Literal('prepare'), commandId: Identifier }),
  Type.Object({
    action: Type.Literal('launch'),
    commandId: Identifier,
    prepared: Type.Union([
      Type.Object({ input: InputSchema, revision: Type.Integer({ minimum: 1 }) }),
      Type.Null(),
    ]),
  }),
  Type.Object({
    action: Type.Literal('capture'),
    source: Type.Union([Type.Literal('selection'), Type.Literal('clipboard')]),
  }),
  Type.Object({
    action: Type.Literal('preview'),
    policy: Type.Union([RunPolicySchema, Type.Null()]),
    input: InputSchema,
    command: Type.Union([CommandSchema, Type.Null()]),
  }),
  Type.Object({
    action: Type.Literal('submit'),
    policy: Type.Union([RunPolicySchema, Type.Null()]),
    invocationId: Identifier,
    taskId: Type.Union([Identifier, Type.Null()]),
    commandId: Type.Union([Identifier, Type.Null()]),
    commandRevision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    savedRun: Type.Union([Type.Object({ taskId: Identifier, runId: Identifier }), Type.Null()]),
    input: InputSchema,
    /** The task's user message entry this run's prompt replaces (edit and resend, regenerate). */
    branchBefore: Type.Optional(SessionEntryId),
  }),
  Type.Object({ action: Type.Literal('stop'), taskId: Identifier, runId: Identifier }),
  Type.Object({
    action: Type.Literal('answer'),
    taskId: Identifier,
    runId: Identifier,
    requestId: Identifier,
    answer: PermissionAnswerSchema,
  }),
  Type.Object({
    action: Type.Literal('queueMessage'),
    taskId: Identifier,
    text: Type.String({ minLength: 1, maxLength: 100000 }),
    /** `followUp` waits for the turn to end; `steer` is injected after the current tool calls. */
    mode: Type.Union([Type.Literal('followUp'), Type.Literal('steer')]),
  }),
  Type.Object({
    action: Type.Literal('replaceQueue'),
    taskId: Identifier,
    followUp: Type.Array(Type.String({ minLength: 1, maxLength: 100000 }), { maxItems: 50 }),
  }),
  Type.Object({
    action: Type.Literal('setPermissionTier'),
    taskId: Identifier,
    tier: PermissionTierSchema,
  }),
  Type.Object({
    action: Type.Literal('renameTask'),
    taskId: Identifier,
    title: Type.String({ minLength: 1, maxLength: 120 }),
  }),
  Type.Object({ action: Type.Literal('deleteTask'), taskId: Identifier }),
  Type.Object({
    action: Type.Literal('compactTask'),
    taskId: Identifier,
    /** Focus for the summary (`/compact <focus>`); the service caps it at 2000 characters. */
    instructions: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
  }),
  Type.Object({ action: Type.Literal('contextBreakdown'), taskId: Identifier }),
  Type.Object({
    action: Type.Literal('forkTask'),
    taskId: Identifier,
    /** The user message entry of the turn the fork ends with. */
    entryId: SessionEntryId,
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  }),
  Type.Object({ action: Type.Literal('chooseFiles') }),
  Type.Object({
    action: Type.Literal('saveMarkdown'),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    text: Type.String({ maxLength: 1000000 }),
  }),
  Type.Object({ action: Type.Literal('memory') }),
  Type.Object({ action: Type.Literal('pauseMemory'), paused: Type.Boolean() }),
  Type.Object({
    action: Type.Literal('updateMemory'),
    entry: MemoryEntrySchema,
    content: Type.String({ maxLength: 20000 }),
  }),
  Type.Object({
    action: Type.Literal('artifact'),
    artifactId: Identifier,
    operation: Type.Union([
      Type.Literal('open'),
      Type.Literal('reveal'),
      Type.Literal('copy'),
      Type.Literal('locate'),
      Type.Literal('attach'),
    ]),
  }),
  Type.Object({ action: Type.Literal('copy'), text: Type.String({ maxLength: 1000000 }) }),
  Type.Object({ action: Type.Literal('openLink'), url: Type.String({ maxLength: 8192 }) }),
  Type.Object({
    action: Type.Literal('childTranscript'),
    taskId: Identifier,
    childKey: ChildKeySchema,
  }),
  Type.Object({
    action: Type.Literal('releaseChildTranscript'),
    taskId: Identifier,
    childKey: ChildKeySchema,
  }),
]);
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
 * (its skill saves or updates entries from the conversation), so a memory target is rejected
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
  /** Offers `text` as a Markdown file in a save panel; false when the user cancelled. */
  saveMarkdown: (name: string, text: string) => Promise<boolean>;
  memory: () => Promise<MemorySnapshot>;
  pauseMemory: (paused: boolean) => Promise<MemorySnapshot>;
  updateMemory: (entry: MemoryEntry, content: string) => Promise<MemorySnapshot>;
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
  onExtensionSession: (listener: (session: ExtensionSession) => void) => () => void;
}
