import { isDeepStrictEqual } from 'node:util';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
  COMPUTER_TOOL,
  isBusinessEffect,
  type ComputerFact,
  type Observation,
  type SurfaceRef,
  type TargetRef,
} from '@atd/agent-contracts';
import type { CallBase, ToolAnswer } from './call-context.js';
import type { ComputerCall } from './calls.js';

export type CompletionAct = Extract<ComputerCall, { action: 'act' }>;

/** One successful input and the observation it actually returned; never reconstructed from text. */
export interface VerifiedInput {
  base: CallBase;
  call: CompletionAct;
  actionId: string;
  sessionId: string;
  target: TargetRef;
  afterRef: Observation['ref'];
  surface?: SurfaceRef;
}

/** A declaration is the whole model-issued batch, never a nested or sibling call. */
export function soleComputerCall(ctx: ExtensionContext, toolCallId: string): boolean {
  for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
    if (entry.type !== 'message') continue;
    if (entry.message.role === 'user') return false;
    if (entry.message.role !== 'assistant') continue;
    const calls = entry.message.content.filter((part) => part.type === 'toolCall');
    return calls.length === 1 && calls[0]?.name === COMPUTER_TOOL && calls[0].id === toolCallId;
  }
  return false;
}

/** The host's successful result still agrees with the issued call and leaves no task hold. */
export function verifiedActFact(
  base: CallBase,
  call: CompletionAct,
  actionId: string,
): ComputerFact | undefined {
  const fact = base.runtime.records.find(actionId);
  if (
    !call.postcondition ||
    !fact ||
    fact.taskId !== base.taskId ||
    fact.runId !== base.runId ||
    fact.phase !== 'settled' ||
    !isDeepStrictEqual(fact.verification, {
      condition: call.postcondition,
      ...(call.surfaceRefId ? { surfaceRefId: call.surfaceRefId } : {}),
    }) ||
    fact.result?.effect !== 'verified' ||
    fact.result.completedSteps !== call.steps.length ||
    fact.result.error ||
    fact.result.stoppedAt !== undefined ||
    fact.result.disturbances?.length ||
    base.runtime.records.unresolved().some((item) => item.taskId === base.taskId)
  )
    return undefined;
  return fact;
}

function observedSurface(observation: Observation): SurfaceRef | undefined {
  return observation.surfaceRefId
    ? observation.surfaces?.find((surface) => surface.id === observation.surfaceRefId)
    : observation.surfaces?.find((surface) => surface.basis === 'root');
}

/** Retain identity and provenance only, not another copy of screenshots or page content. */
export function verifiedInput(
  base: CallBase,
  call: CompletionAct,
  answer: ToolAnswer,
  ctx: ExtensionContext,
): VerifiedInput | undefined {
  const actionId = answer.details.actionId;
  const observation = answer.snapshot?.observation;
  const target = base.runtime.coordinator.target(base.runId, call.targetRefId);
  if (
    !actionId ||
    !observation ||
    !target ||
    observation.ref.targetRefId !== target.id ||
    observation.surfaceRefId !== call.surfaceRefId ||
    call.resolves?.length
  )
    return undefined;
  const fact = verifiedActFact(base, call, actionId);
  if (
    !fact ||
    !isBusinessEffect(fact.effect) ||
    fact.bindingId !== target.bindingId ||
    fact.result?.dispatch !== 'settled' ||
    fact.resolution
  )
    return undefined;
  const current = base.runtime.coordinator.snapshots.get(
    base.runId,
    target.id,
    observation.ref.id,
    target.hostGeneration,
  );
  if (current !== answer.snapshot) return undefined;
  const surface = observedSurface(observation);
  if (call.surfaceRefId && !surface) return undefined;
  return {
    base,
    call,
    actionId,
    sessionId: ctx.sessionManager.getSessionId(),
    target: structuredClone(target),
    afterRef: { ...observation.ref },
    ...(surface ? { surface: { ...surface } } : {}),
  };
}

/** Ignore timing/custom entries, but require the preceding call and its real successful result. */
function adjacentCalls(ctx: ExtensionContext, source: VerifiedInput, toolCallId: string): boolean {
  let currentSeen = false;
  let sourceResultSeen = false;
  for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (message.role === 'toolResult') {
      const expected = currentSeen ? source.base.toolCallId : toolCallId;
      if (message.toolCallId !== expected || message.isError) return false;
      if (currentSeen) sourceResultSeen = true;
    } else if (message.role === 'assistant') {
      const calls = message.content.filter((part) => part.type === 'toolCall');
      const expected = currentSeen ? source.base.toolCallId : toolCallId;
      if (calls.length !== 1 || calls[0]?.name !== COMPUTER_TOOL || calls[0].id !== expected)
        return false;
      if (currentSeen) return sourceResultSeen;
      currentSeen = true;
    } else return false;
  }
  return false;
}

/**
 * A fresh wait may finish the immediately preceding verified input. It proves the current state,
 * not causation: the model declares that the input's returned page evidence covers the other goals.
 */
export function supplementalFact(
  source: VerifiedInput,
  base: CallBase,
  call: CompletionAct,
  actionId: string,
  ctx: ExtensionContext,
): ComputerFact | undefined {
  const [step] = call.steps;
  if (
    call.steps.length !== 1 ||
    step?.kind !== 'wait' ||
    !call.postcondition ||
    call.postcondition.kind === 'newText' ||
    call.postcondition.kind === 'enabled' ||
    !isDeepStrictEqual(step.condition, call.postcondition) ||
    call.resolves?.length ||
    source.base.signal?.aborted ||
    source.base.runId !== base.runId ||
    source.base.taskId !== base.taskId ||
    source.sessionId !== ctx.sessionManager.getSessionId() ||
    source.actionId === actionId ||
    source.call.targetRefId !== call.targetRefId ||
    source.call.surfaceRefId !== call.surfaceRefId ||
    source.afterRef.id !== call.observationRefId ||
    !adjacentCalls(ctx, source, base.toolCallId)
  )
    return undefined;
  const coordinator = base.runtime.coordinator;
  const target = coordinator.target(base.runId, call.targetRefId);
  if (!isDeepStrictEqual(target, source.target)) return undefined;
  const snapshot = coordinator.snapshots.get(
    base.runId,
    call.targetRefId,
    call.observationRefId,
    source.target.hostGeneration,
  );
  if (
    !snapshot ||
    !isDeepStrictEqual(snapshot.observation.ref, source.afterRef) ||
    snapshot.observation.surfaceRefId !== call.surfaceRefId ||
    !isDeepStrictEqual(observedSurface(snapshot.observation), source.surface)
  )
    return undefined;
  const prior = verifiedActFact(base, source.call, source.actionId);
  const fact = verifiedActFact(base, call, actionId);
  return prior &&
    isBusinessEffect(prior.effect) &&
    prior.bindingId === source.target.bindingId &&
    prior.result?.dispatch === 'settled' &&
    !prior.resolution &&
    fact?.effect === 'read' &&
    fact.bindingId === source.target.bindingId &&
    fact.result?.dispatch === 'not_dispatched' &&
    !fact.resolution
    ? fact
    : undefined;
}
