import { setTimeout } from 'node:timers/promises';
import {
  COMPUTER_ENGINE_FOR_KIND,
  type ComputerAction,
  type ComputerFact,
  type TargetRef,
} from '@atd/agent-contracts';
import { envelopeFor, type CallContext } from './call-context.js';
import { observationOutput } from './observation-output.js';

// Native tree, capture and OCR reads can exceed five seconds; do not force a second model
// turn and repeat the same read while a normal full observation is still completing.
const NEXT_OBSERVATION_MS = 10_000;

/**
 * A best-effort read after a settled write or a no-input stale refusal; never retries input. A
 * write that settled without verifying, because its postcondition did not hold, gets one too, so
 * the model judges the state the unconfirmed action left from it instead of observing first.
 */
export async function nextObservation(
  ctx: CallContext,
  action: ComputerAction,
  targetRef: TargetRef,
  fact: ComputerFact,
) {
  const { coordinator } = ctx.runtime;
  if (
    ctx.unattended ||
    ctx.signal?.aborted ||
    coordinator.isClosed(ctx.runId) ||
    (!staleBeforeDispatch(fact) && !settledWrite(fact, action))
  )
    return null;
  const output = await readNextObservation(ctx, targetRef, action.surfaceRefId);
  if (staleBeforeDispatch(fact))
    return {
      ...output,
      next:
        'nextObservation' in output
          ? 'Nothing was sent. Inspect the fresh nextObservation image, locate the intended control again, and use its observationRefId and a new actionId. Never replay the old coordinates.'
          : 'Nothing was sent. Obtain a fresh observation, inspect it and locate the control again before another action with a new actionId. Never replay the old coordinates.',
    };
  return fact.result?.effect === 'partial' && 'nextObservation' in output
    ? {
        ...output,
        next: 'Inspect the fresh nextObservation, read after the steps, instead of observing again; what it shows does not confirm this action.',
      }
    : output;
}

/**
 * A write whose every step ran and settled without error: `verified`, or `partial` because its
 * postcondition did not hold after the steps, the only way such a result is partial (the host
 * reports an action that stopped with its error).
 */
function settledWrite(fact: ComputerFact, action: ComputerAction): boolean {
  const result = fact.result;
  return (
    fact.effect !== 'read' &&
    (result?.effect === 'verified' || result?.effect === 'partial') &&
    result.dispatch === 'settled' &&
    result.completedSteps === action.steps.length &&
    result.error === undefined
  );
}

/** Only an explicit no-input stale failure may obtain a recovery observation. */
function staleBeforeDispatch(fact: ComputerFact): boolean {
  const result = fact.result;
  return (
    result?.error?.code === 'staleObservation' &&
    result.dispatch === 'not_dispatched' &&
    result.effect === 'none' &&
    result.completedSteps === 0
  );
}

/** One bounded operational read shared by access setup and post-action results. */
export async function readNextObservation(
  ctx: CallContext,
  targetRef: TargetRef,
  surfaceRefId?: string,
) {
  const { coordinator } = ctx.runtime;
  if (ctx.unattended || ctx.signal?.aborted || coordinator.isClosed(ctx.runId))
    return { nextObservationUnavailable: true };
  // Native observations read text from their screenshot and must keep its capture.
  const native = targetRef.engine === COMPUTER_ENGINE_FOR_KIND.native;
  const controller = new AbortController();
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, controller.signal]) : controller.signal;
  const read = async () => {
    const outcome = await coordinator.request(
      envelopeFor(ctx, NEXT_OBSERVATION_MS),
      {
        kind: 'observe',
        targetRef,
        ...(surfaceRefId ? { surfaceRefId } : {}),
        include: { tree: true, screenshot: true, text: native },
      },
      { signal, timeoutMs: NEXT_OBSERVATION_MS },
    );
    signal.throwIfAborted();
    if (outcome.kind !== 'reply' || !outcome.reply.ok || outcome.reply.value.kind !== 'observation')
      throw new Error('The post-action observation was unavailable.');
    const output = await observationOutput(
      { ...ctx, signal },
      targetRef.id,
      targetRef.bindingId,
      outcome.reply.value.observation,
    );
    if (!output.saved || (native && !outcome.reply.value.observation.capture))
      throw new Error('The post-action screenshot could not be retained.');
    return output;
  };
  const timer = new AbortController();
  try {
    const output = await Promise.race([
      read(),
      setTimeout(NEXT_OBSERVATION_MS, undefined, { signal: timer.signal }).then(() => {
        controller.abort();
        throw new Error('The post-action observation exceeded its ten-second limit.');
      }),
    ]);
    return {
      nextObservation: output.facts,
      snapshot: output.snapshot,
      image: output.image,
      resourceId: output.saved?.resourceId,
    };
  } catch {
    return { nextObservationUnavailable: true };
  } finally {
    timer.abort();
  }
}
