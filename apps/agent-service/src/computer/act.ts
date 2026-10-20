import { createHash, randomUUID } from 'node:crypto';
import {
  canonicalJson,
  COMPUTER_ENGINE_FOR_KIND,
  COMPUTER_TOOL,
  type ActionResult,
  type ComputerAction,
  type ComputerActionInput,
  type ComputerError,
  type ComputerFact,
} from '@atd/agent-contracts';
import {
  auditComputer,
  envelopeFor,
  refuse,
  type CallContext,
  type ToolAnswer,
} from './call-context.js';
import type { HostOutcome } from './coordinator.js';
import { computerDetails, stepSummary } from './details.js';
import { checkAct, runBinding, type AllowedAction } from './policy.js';
import { readRunFacts } from './records.js';
import { resolveVerified } from './resolve.js';
import { importDownloads, withUploadPaths, type ImportedDownload } from './transfers.js';
import { nextObservation } from './next-observation.js';
import { refusalGuidance } from './refusals.js';
import { visualState } from './visual-qualifications.js';

/** The host answers an action within this, plus the time its waits may take. */
const ACT_BASE_TIMEOUT_MS = 60_000;
/** The longest a single action may take, waits included. */
const ACT_MAX_TIMEOUT_MS = 5 * 60_000;
/** What a menu path or a drag may add: menus open level by level, a drag moves in steps. */
const SLOW_STEP_MS = 15_000;
/** What each typed character may add: `type` sends keystrokes one by one. */
const TYPE_MS_PER_CHAR = 15;

/** The time one step may add to the base: its own wait, or what slow steps need. */
function stepTime(step: ComputerAction['steps'][number]): number {
  switch (step.kind) {
    case 'wait':
      return step.timeoutMs;
    case 'menu':
    case 'drag':
      return SLOW_STEP_MS;
    case 'type':
      return step.text.length * TYPE_MS_PER_CHAR;
    case 'navigate':
    case 'fill':
    case 'press':
    case 'scroll':
    case 'setValue':
    case 'click':
    case 'key':
    case 'clear':
    case 'select':
    case 'upload':
      return 0;
  }
}

function actTimeout(action: ComputerAction): number {
  const extra = action.steps.reduce((sum, step) => sum + stepTime(step), 0);
  return Math.min(ACT_BASE_TIMEOUT_MS + extra, ACT_MAX_TIMEOUT_MS);
}

/**
 * A result for an action the host refused or never received: nothing happened, so it may be
 * retried once its cause is gone. A host refusal keeps its `reason`.
 */
function notDispatched(actionId: string, error: ComputerError): ActionResult {
  return {
    actionId,
    dispatch: 'not_dispatched',
    effect: 'none',
    completedSteps: 0,
    error: { ...error, message: error.message.slice(0, 2000) },
    evidence: [],
    retry: 'safe',
  };
}

/**
 * The fact an action's outcome records. A host reply settles it; an action that was never sent
 * settles as not dispatched; one sent without a reply stays `dispatched` without a result, which
 * makes it unresolved until `status` or a person settles it.
 */
function settledFact(intent: ComputerFact, outcome: HostOutcome): ComputerFact {
  const at = new Date().toISOString();
  const { actionId } = intent;
  switch (outcome.kind) {
    case 'reply': {
      const { reply } = outcome;
      if (!reply.ok)
        return { ...intent, phase: 'settled', at, result: notDispatched(actionId, reply.error) };
      if (reply.value.kind === 'actionResult' && reply.value.result.actionId === actionId)
        return { ...intent, phase: 'settled', at, result: reply.value.result };
      return { ...intent, phase: 'dispatched', at };
    }
    case 'unsent':
      return {
        ...intent,
        phase: 'settled',
        at,
        result: notDispatched(actionId, {
          code: outcome.code,
          message: outcome.message ?? 'The action was not sent to the computer host.',
        }),
      };
    case 'lost':
      return { ...intent, phase: 'dispatched', at };
  }
}

/**
 * What the model reads of an action's fact, the earlier actions its result resolved, the
 * downloads it imported as task files (or could not) and, after a background refusal, what to do
 * next (refusals.ts).
 */
function answerText(
  fact: ComputerFact,
  repeated: boolean,
  resolved: readonly string[] = [],
  files: { downloads: readonly ImportedDownload[]; notImported: readonly string[] } | null = null,
  extra: Record<string, unknown> = {},
): string {
  const guidance = fact.result?.error ? refusalGuidance(fact.result.error) : null;
  const base = {
    ...extra,
    ...(guidance ? { next: guidance } : {}),
    actionId: fact.actionId,
    effect: fact.effect,
    phase: fact.phase,
    ...(resolved.length ? { resolved } : {}),
    ...(files?.downloads.length ? { downloads: files.downloads } : {}),
    ...(files?.notImported.length ? { downloadsNotImported: files.notImported } : {}),
  };
  if (fact.result)
    return JSON.stringify({ ...base, ...(repeated ? { repeated } : {}), result: fact.result });
  return JSON.stringify({
    ...base,
    ...(repeated ? { repeated } : {}),
    outcome: 'unknown',
    note: 'The action was sent but no result came back. Do not repeat it; check it later with status.',
  });
}

/**
 * `act`: checks the action against the run's scope, asks the gate in attended runs, records the
 * intent durably, sends it to the host and records what came back. Repeating an action id of
 * this run answers its recorded fact without sending anything again.
 */
export async function runAct(ctx: CallContext, input: ComputerActionInput): Promise<ToolAnswer> {
  const { runtime } = ctx;
  const actionId = input.actionId ?? randomUUID();
  const facts = await readRunFacts(runtime.dataDir, ctx.runId);
  const existing = facts.find((fact) => fact.actionId === actionId);
  if (existing) {
    auditComputer(ctx, 'repeated', { actionId });
    return {
      text: answerText(existing, true),
      details: computerDetails({
        op: 'act',
        bindingId: existing.bindingId,
        actionId,
        result: existing.result,
      }),
    };
  }
  const elsewhere = runtime.records.find(actionId);
  if (elsewhere && elsewhere.runId !== ctx.runId)
    refuse(ctx, 'That actionId belongs to another run.');
  const targetRef = runtime.coordinator.target(ctx.runId, input.targetRefId);
  if (!targetRef) refuse(ctx, 'Unknown or outdated targetRefId: call targets again.');
  const known = { bindingId: targetRef.bindingId };
  if (!runtime.engineInstalled(targetRef.engine))
    refuse(
      ctx,
      'The target engine was removed. Install its add-on and call targets again; nothing was sent.',
      known,
    );
  const binding = runBinding(ctx.computer, targetRef.bindingId, runtime.bindings);
  if (!('bindingId' in binding)) refuse(ctx, binding.message, known);
  if (binding.revision !== targetRef.bindingRevision)
    refuse(ctx, 'The target changed since it was resolved: call targets again.', known);
  const { coordinator } = runtime;
  const checked = checkAct(
    {
      scope: ctx.scope,
      unattended: ctx.unattended,
      binding,
      targetRef,
      profile: coordinator.profile(COMPUTER_ENGINE_FOR_KIND[binding.kind]),
      facts,
      taskUnresolved: runtime.records
        .unresolved()
        .filter((fact) => fact.taskId === ctx.taskId && fact.bindingId === binding.bindingId),
      visual: visualState(ctx.model),
      visualOverride: runtime.visualOverride,
      capture: (captureId) => coordinator.capture(ctx.runId, targetRef.id, captureId),
    },
    input,
    actionId,
  );
  if (!checked.ok) refuse(ctx, checked.message, { bindingId: binding.bindingId });
  if (checked.visualOverride)
    auditComputer(ctx, 'visualOverride', { actionId, bindingId: binding.bindingId });
  // Upload files are resolved before the person is asked: a foreign or missing file never reaches
  // the gate.
  const allowed = {
    ...checked,
    action: await withUploadPaths(ctx, checked.action, binding.bindingId),
  };
  await authorize(ctx, allowed, binding);
  ctx.signal?.throwIfAborted();
  if (!runtime.engineInstalled(targetRef.engine))
    refuse(ctx, 'The target engine was removed while awaiting approval; nothing was sent.', known);
  const { action, effect, recipeStepId } = allowed;
  const grantRef = ctx.scope.mode === 'grant' ? ctx.scope.grantRef : undefined;
  const automationRunId = ctx.snapshot.trigger?.automationRunId;
  const intent: ComputerFact = {
    actionId,
    runId: ctx.runId,
    taskId: ctx.taskId,
    ...(automationRunId ? { automationRunId } : {}),
    ...(recipeStepId ? { recipeStepId } : {}),
    bindingId: binding.bindingId,
    effect,
    phase: 'intent',
    intentHash: createHash('sha256')
      .update(
        canonicalJson({ action, bindingId: binding.bindingId, effect, grantRef: grantRef ?? null }),
      )
      .digest('hex'),
    ...(grantRef ? { grantRef } : {}),
    ...(action.postcondition
      ? {
          verification: {
            condition: action.postcondition,
            ...(action.surfaceRefId ? { surfaceRefId: action.surfaceRefId } : {}),
          },
        }
      : {}),
    at: new Date().toISOString(),
  };
  // Durable before anything is sent: a crash from here on leaves an unresolved fact.
  await runtime.records.append(intent);
  const timeoutMs = actTimeout(action);
  const outcome = await runtime.coordinator.request(
    envelopeFor(ctx, timeoutMs),
    { kind: 'act', action },
    { signal: ctx.signal, timeoutMs, bindingId: binding.bindingId },
  );
  const settled = settledFact(intent, outcome);
  const files = settled.result ? await importDownloads(ctx, settled.result) : null;
  const fact = files ? { ...settled, result: files.result } : settled;
  await runtime.records.append(fact);
  const resolved =
    checked.resolves && fact.result?.effect === 'verified'
      ? await resolveVerified(runtime.records, checked.resolves, fact)
      : [];
  auditComputer(ctx, 'act', {
    actionId,
    bindingId: binding.bindingId,
    effect,
    ...(fact.result?.route ? { route: fact.result.route } : {}),
    ...(resolved.length ? { resolved } : {}),
    ...(recipeStepId ? { recipeStepId } : {}),
    outcome: outcome.kind,
    dispatch: fact.result?.dispatch ?? 'unknown',
    result: fact.result?.effect ?? 'unknown',
  });
  const next = await nextObservation(ctx, action, targetRef, fact);
  const { image, resourceId, snapshot, ...extra } = next ?? {};
  return {
    text: answerText(fact, false, resolved, files, extra),
    ...(image ? { image } : {}),
    ...(snapshot ? { snapshot } : {}),
    details: computerDetails({
      op: 'act',
      target: binding.label,
      bindingId: binding.bindingId,
      actionId,
      steps: action.steps,
      result: fact.result,
      resourceIds: [
        ...(files?.downloads.map((download) => download.resourceId) ?? []),
        ...(resourceId ? [resourceId] : []),
      ],
    }),
  };
}

/**
 * The approval gate on the action's highest effect for one revision of the binding
 * (`computer:<binding>@<revision>:<effect>`) in attended runs, trial runs included, so an approval
 * never covers an edited target. Every action runs in the background, so the scope names no
 * delivery. An unattended run acts only under its live grant, which the scope check already
 * verified; it never reaches the gate, whose tier would not apply to it.
 */
async function authorize(
  ctx: CallContext,
  allowed: AllowedAction,
  binding: { bindingId: string; revision: number; label: string },
): Promise<void> {
  const { bindingId, revision, label } = binding;
  const { effect } = allowed;
  if (ctx.scope.mode === 'grant') {
    auditComputer(ctx, 'grant', { bindingId, effect });
    return;
  }
  const lines = allowed.action.steps.map((step) => `- ${stepSummary(step)}`);
  await ctx.gate({
    toolCallId: ctx.toolCallId,
    scope: { tool: COMPUTER_TOOL, bindingId, revision, effect },
    title: `${label}: ${effect}`,
    detail: [`Target: ${label}`, ...lines].join('\n'),
    signal: ctx.signal,
  });
}
