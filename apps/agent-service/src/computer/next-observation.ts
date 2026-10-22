import { setTimeout } from 'node:timers/promises';
import {
  COMPUTER_ENGINE_FOR_KIND,
  type ComputerAction,
  type ComputerError,
  type ComputerFact,
  type Observation,
  type TargetRef,
} from '@atd/agent-contracts';
import { auditComputer, envelopeFor, type CallContext } from './call-context.js';
import { observationOutput } from './observation-output.js';

// Native tree, capture and OCR reads can exceed five seconds; do not force a second model
// turn and repeat the same read while a normal full observation is still completing.
const NEXT_OBSERVATION_MS = 10_000;

export interface ObservationReadFailureDetails {
  errorType:
    | 'unattended'
    | 'cancelled'
    | 'runClosed'
    | 'requestUnsent'
    | 'requestLost'
    | 'hostError'
    | 'unexpectedReply'
    | 'screenshotMissing'
    | 'screenshotRetentionFailed'
    | 'captureMissing'
    | 'deadlineExceeded'
    | 'unexpectedException';
  code?: ComputerError['code'];
  reason?: ComputerError['reason'];
  transportReason?: 'timeout' | 'disconnected' | 'cancelled';
}

interface ObservationReadOptions {
  timeoutMs?: number;
  /** Internal recovery decisions; failure details are not part of the model's preview. */
  onFailure?: (failure: ObservationReadFailureDetails) => void;
}

export interface NextObservationOptions {
  /** Model acts opt in; access setup already reads once after its internal wait. */
  afterWaitTimeout?: boolean;
}

/** Internal diagnostics only: never retain host messages, page content or image bytes. */
class ObservationReadFailure extends Error {
  constructor(readonly details: ObservationReadFailureDetails) {
    super(details.errorType);
  }
}

/**
 * A best-effort read after a settled write, targeting refusal or opted-in wait timeout; never retries input. A
 * write that settled without verifying, because its postcondition did not hold, gets one too, so
 * the model judges the state the unconfirmed action left from it instead of observing first.
 */
export async function nextObservation(
  ctx: CallContext,
  action: ComputerAction,
  targetRef: TargetRef,
  fact: ComputerFact,
  options: NextObservationOptions = {},
) {
  const { coordinator } = ctx.runtime;
  const recovering = recoveryBeforeDispatch(fact, action, targetRef);
  const waiting = options.afterWaitTimeout === true && timedOutWait(fact, action, targetRef);
  if (
    ctx.unattended ||
    ctx.signal?.aborted ||
    coordinator.isClosed(ctx.runId) ||
    (!recovering && !waiting && !settledWrite(fact, action))
  )
    return null;
  const output = await readNextObservation(ctx, targetRef, action.surfaceRefId);
  if (recovering)
    return {
      ...output,
      next:
        'nextObservation' in output
          ? 'Nothing was sent. Inspect the fresh nextObservation image, locate the intended control again, and use its observationRefId for a new act with actionId omitted. Never replay the old coordinates.'
          : 'Nothing was sent. Obtain a fresh observation, inspect it and locate the control again before a new act with actionId omitted. Never replay the old coordinates.',
    };
  if (waiting)
    return {
      ...output,
      next:
        'nextObservation' in output
          ? 'The wait condition was not met. Inspect the fresh nextObservation before deciding what to do next; this image does not verify the timed-out wait or resolve earlier unconfirmed actions.'
          : 'The wait condition was not met and a fresh observation is unavailable. Observe before further input; earlier unconfirmed actions remain unresolved.',
    };
  return fact.result?.effect === 'partial' && 'nextObservation' in output
    ? {
        ...output,
        next: 'Inspect the fresh nextObservation, read after the steps; what it shows does not confirm this action. Observe again only if it is still loading, missing needed information or contradictory.',
      }
    : output;
}

/** Only a confirmed timeout of one read-only native wait, never a lost or mixed action. */
function timedOutWait(fact: ComputerFact, action: ComputerAction, targetRef: TargetRef): boolean {
  const result = fact.result;
  return (
    targetRef.engine === COMPUTER_ENGINE_FOR_KIND.native &&
    fact.phase === 'settled' &&
    fact.effect === 'read' &&
    action.steps.length === 1 &&
    action.steps[0]?.kind === 'wait' &&
    result?.dispatch === 'not_dispatched' &&
    result.effect === 'none' &&
    result.completedSteps === 0 &&
    result.stoppedAt === 0 &&
    result.error?.code === 'timeout'
  );
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

/** A no-input stale refusal or first native click whose locator could not resolve. */
function recoveryBeforeDispatch(
  fact: ComputerFact,
  action: ComputerAction,
  targetRef: TargetRef,
): boolean {
  const result = fact.result;
  if (
    result?.dispatch !== 'not_dispatched' ||
    result.effect !== 'none' ||
    result.completedSteps !== 0
  )
    return false;
  if (result.error?.code === 'staleObservation') return true;
  const first = action.steps[0];
  // A stopped step distinguishes locator failure from admission or condition validation,
  // which can report the same codes without having tried to locate the input target.
  return (
    targetRef.engine === COMPUTER_ENGINE_FOR_KIND.native &&
    result.stoppedAt === 0 &&
    first?.kind === 'click' &&
    !('capture' in first.locator) &&
    (result.error?.code === 'notFound' || result.error?.code === 'ambiguous')
  );
}

/** One bounded operational read shared by access setup and post-action results. */
export async function readNextObservation(
  ctx: CallContext,
  targetRef: TargetRef,
  surfaceRefId?: string,
  options: ObservationReadOptions = {},
) {
  const { coordinator } = ctx.runtime;
  const started = performance.now();
  const timeoutMs = Math.min(NEXT_OBSERVATION_MS, options.timeoutMs ?? NEXT_OBSERVATION_MS);
  let stage: 'admission' | 'request' | 'reply' | 'output' = 'admission';
  let observationDiagnostics:
    | { problems: Observation['problems']; hasScreenshot: boolean; hasCapture: boolean }
    | undefined;
  const auditUnavailable = (failure: ObservationReadFailureDetails): void => {
    auditComputer(ctx, 'next-observation-unavailable', {
      bindingId: targetRef.bindingId,
      stage,
      elapsedMs: Math.round(performance.now() - started),
      ...failure,
      ...observationDiagnostics,
    });
    options.onFailure?.(failure);
  };
  if (ctx.unattended) {
    auditUnavailable({ errorType: 'unattended' });
    return { nextObservationUnavailable: true };
  }
  if (ctx.signal?.aborted) {
    auditUnavailable({ errorType: 'cancelled' });
    return { nextObservationUnavailable: true };
  }
  if (coordinator.isClosed(ctx.runId)) {
    auditUnavailable({ errorType: 'runClosed' });
    return { nextObservationUnavailable: true };
  }
  if (timeoutMs <= 0) {
    auditUnavailable({ errorType: 'deadlineExceeded' });
    return { nextObservationUnavailable: true };
  }
  // Native observations read text from their screenshot and must keep its capture.
  const native = targetRef.engine === COMPUTER_ENGINE_FOR_KIND.native;
  const controller = new AbortController();
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, controller.signal]) : controller.signal;
  const read = async () => {
    stage = 'request';
    const outcome = await coordinator.request(
      envelopeFor(ctx, timeoutMs),
      {
        kind: 'observe',
        targetRef,
        ...(surfaceRefId ? { surfaceRefId } : {}),
        include: { tree: true, screenshot: true, text: native },
      },
      { signal, timeoutMs },
    );
    signal.throwIfAborted();
    stage = 'reply';
    if (outcome.kind === 'unsent')
      throw new ObservationReadFailure({ errorType: 'requestUnsent', code: outcome.code });
    if (outcome.kind === 'lost')
      throw new ObservationReadFailure({
        errorType: 'requestLost',
        transportReason: outcome.reason,
      });
    if (!outcome.reply.ok)
      throw new ObservationReadFailure({
        errorType: 'hostError',
        code: outcome.reply.error.code,
        ...(outcome.reply.error.reason ? { reason: outcome.reply.error.reason } : {}),
      });
    if (outcome.reply.value.kind !== 'observation')
      throw new ObservationReadFailure({ errorType: 'unexpectedReply' });
    const { observation } = outcome.reply.value;
    observationDiagnostics = {
      problems: observation.problems,
      hasScreenshot: observation.screenshot !== undefined,
      hasCapture: observation.capture !== undefined,
    };
    stage = 'output';
    const output = await observationOutput(
      { ...ctx, signal },
      targetRef.id,
      targetRef.bindingId,
      observation,
    );
    if (!output.saved)
      throw new ObservationReadFailure({
        errorType: observation.screenshot ? 'screenshotRetentionFailed' : 'screenshotMissing',
      });
    if (native && !observation.capture)
      throw new ObservationReadFailure({ errorType: 'captureMissing' });
    return output;
  };
  const timer = new AbortController();
  try {
    const output = await Promise.race([
      read(),
      setTimeout(timeoutMs, undefined, { signal: timer.signal }).then(() => {
        controller.abort();
        throw new ObservationReadFailure({ errorType: 'deadlineExceeded' });
      }),
    ]);
    signal.throwIfAborted();
    if (performance.now() - started >= timeoutMs) {
      controller.abort();
      throw new ObservationReadFailure({ errorType: 'deadlineExceeded' });
    }
    return {
      nextObservation: output.facts,
      snapshot: output.snapshot,
      image: output.image,
      resourceId: output.saved?.resourceId,
    };
  } catch (error) {
    let failure: ObservationReadFailureDetails =
      error instanceof ObservationReadFailure
        ? error.details
        : { errorType: 'unexpectedException' };
    if (ctx.signal?.aborted) failure = { errorType: 'cancelled' };
    else if (controller.signal.aborted) failure = { errorType: 'deadlineExceeded' };
    auditUnavailable(failure);
    return { nextObservationUnavailable: true };
  } finally {
    timer.abort();
  }
}
