import { RunPolicySchema, type RunPolicy } from './run-policy';
import { Type, type Static } from 'typebox';
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
import type { Block, QueueState, TranscriptPatch } from './transcript-schema';

export const AGENT_IPC = {
  request: 'agent:request',
  changed: 'agent:changed',
  launch: 'agent:launch',
  session: 'agent:command-session',
  extensionSession: 'agent:extension-session',
} as const;
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
}
/** The state plus the current transcript snapshot; returned by `detail` and used to (re)seed a consumer. */
export interface TaskDetail extends TaskState {
  revision: number;
  blocks: Block[];
  /** T6 additive: explicit child results aggregated from subagent tool blocks. */
  children?: {
    executionId: string;
    agent: string;
    ok: boolean;
    output: string;
    runId: string | null;
    sessionFile: string | null;
    error: string;
  }[];
  /** T6 additive: pending desktop capabilities for waiting-desktop surfacing. */
  capabilities?: {
    id: string;
    capability: string;
    runId: string;
    executionId: string;
    expiresAt: string;
  }[];
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
  Type.Object({ action: Type.Literal('chooseFiles') }),
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
  Type.Object({ action: Type.Literal('importLegacy'), json: Type.String({ maxLength: 8000000 }) }),
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

/** Hands Extensions create-with-AI off to a new panel session seeded with an app skill. */
export type ExtensionSessionKind = 'skill' | 'subagent' | 'mcp';
export interface ExtensionSession {
  kind: ExtensionSessionKind;
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
  stop: (taskId: string, runId: string) => Promise<void>;
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
  chooseFiles: () => Promise<FileRef[]>;
  memory: () => Promise<MemorySnapshot>;
  pauseMemory: (paused: boolean) => Promise<MemorySnapshot>;
  updateMemory: (entry: MemoryEntry, content: string) => Promise<MemorySnapshot>;
  artifact: (
    artifactId: string,
    operation: 'open' | 'reveal' | 'copy' | 'locate' | 'attach',
  ) => Promise<FileRef | null>;
  copy: (text: string) => Promise<void>;
  openLink: (url: string) => Promise<void>;
  importLegacy: (json: string) => Promise<void>;
  onChange: (listener: (event: AgentEvent) => void) => () => void;
  onLaunch: (listener: (launch: CommandLaunch) => void) => () => void;
  onCommandSession: (listener: (session: CommandSession) => void) => () => void;
  onExtensionSession: (listener: (session: ExtensionSession) => void) => () => void;
}
