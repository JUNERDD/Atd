import { randomUUID } from 'node:crypto';
import type { ImageContent } from '@earendil-works/pi-ai';
import {
  COMPUTER_TOOL,
  type ComputerDetails,
  type ComputerError,
  type ComputerTargetKind,
  type ExecutionEnvelope,
  type RunComputer,
  type PermissionTier,
  type RunSnapshot,
} from '@atd/agent-contracts';
import type { Gate } from '../harness/gate.js';
import type { Logger } from '../logging.js';
import type { ResourceStore } from '../resources.js';
import { auditUnattended } from '../unattended.js';
import { foregroundAllowed } from './foreground.js';
import type { RunScope } from './policy.js';
import type { ComputerRuntime } from './runtime.js';
import type { ComputerSnapshot } from './snapshots.js';
import type { VisualSubject } from './visual-qualifications.js';

/** One `computer` call, as read from the current run when it executes. */
export interface CallBase {
  /** The run's model as visual qualification judges it. */
  model: VisualSubject;
  runtime: ComputerRuntime;
  resources: ResourceStore;
  taskId: string;
  runId: string;
  executionId: string;
  toolCallId: string;
  signal: AbortSignal | undefined;
  snapshot: RunSnapshot;
  unattended: boolean;
  tier: PermissionTier;
  gate: Gate;
  audit: (entry: Record<string, unknown>) => void;
  log: Logger;
}

/** A call of a run that may use the computer, with the scope it acts in. */
export interface CallContext extends CallBase {
  computer: RunComputer;
  scope: Extract<RunScope, { ok: true }>;
}

/** What one call answers: facts for the model, details for the transcript projector. */
export interface ToolAnswer {
  text: string;
  details: ComputerDetails;
  image?: ImageContent;
  /** Private execution state; never include it in model text or transcript details. */
  snapshot?: ComputerSnapshot;
}

/** Appends one computer audit line; never with typed text, page content or screenshots. */
export function auditComputer(
  ctx: CallBase,
  decision: string,
  fields: Record<string, unknown> = {},
): void {
  ctx.audit({
    taskId: ctx.taskId,
    runId: ctx.runId,
    executionId: ctx.executionId,
    toolCallId: ctx.toolCallId,
    tool: COMPUTER_TOOL,
    decision,
    ...fields,
  });
}

/**
 * A refused call, thrown by `refuse`. `bindingId` names the registered target the call had
 * resolved before it was refused, if any, `error` the host's own refusal or failure of a non-act
 * operation, and `blockedBy` the earlier business actions whose unconfirmed outcome held a refused
 * `act` back; the tool then answers an error result whose details carry them
 * (computer/extension.ts).
 */
export class ComputerRefusal extends Error {
  constructor(
    message: string,
    readonly bindingId: string | undefined,
    readonly error?: ComputerError,
    readonly blockedBy?: readonly string[],
  ) {
    super(message);
  }
}

/** What a refusal concerned, audited with it; `ComputerRefusal` carries the fields it names. */
export interface RefusalFields {
  bindingId?: string;
  blockedBy?: readonly string[];
  [field: string]: unknown;
}

/**
 * Refuses a call the scope check does not allow, or one the host refused (`error`): audited, then
 * thrown as the tool's error (`ComputerRefusal`, with `fields.bindingId` and `fields.blockedBy`
 * when set). In an unattended run the refusal is an unattended answer, so the automation reports
 * that the run needs attention.
 */
export function refuse(
  ctx: CallBase,
  message: string,
  fields: RefusalFields = {},
  error?: ComputerError,
): never {
  if (ctx.unattended)
    auditUnattended(ctx.audit, {
      taskId: ctx.taskId,
      runId: ctx.runId,
      tool: COMPUTER_TOOL,
      kind: 'computer',
      title: message,
      ...fields,
    });
  else auditComputer(ctx, 'refused', { reason: message, ...fields });
  throw new ComputerRefusal(message, fields.bindingId, error, fields.blockedBy);
}

/**
 * The execution envelope of one host request, from the current run and never from the model.
 * Each request is its own operation, and an unattended run's carries its grant reference. No run
 * chooses how the host delivers: `kinds` names the kinds of the targets whose steps the request
 * acts on or describes (`act`, `targets`), which with the run decide whether the host may fall
 * back to the foreground (foreground.ts); any other request names none and stays background only.
 */
export function envelopeFor(
  ctx: CallContext,
  timeoutMs: number,
  kinds: readonly ComputerTargetKind[] = [],
): ExecutionEnvelope {
  const grantRef = ctx.scope.mode === 'grant' ? ctx.scope.grantRef : undefined;
  return {
    taskId: ctx.taskId,
    runId: ctx.runId,
    executionId: ctx.executionId,
    toolCallId: ctx.toolCallId,
    operationId: randomUUID(),
    ...(grantRef ? { grantRef } : {}),
    unattended: ctx.unattended,
    foregroundAllowed: foregroundAllowed(ctx, kinds),
    deadlineAt: new Date(Date.now() + timeoutMs).toISOString(),
  };
}
