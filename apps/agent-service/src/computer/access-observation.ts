import { setTimeout } from 'node:timers/promises';
import type { Observation, TargetRef } from '@atd/agent-contracts';
import { runAct } from './act.js';
import { auditComputer, type CallContext } from './call-context.js';
import { readNextObservation } from './next-observation.js';
import { resolveTargets } from './operations.js';

/** Optional read-only readiness requested with access; no input is sent while waiting. */
export interface AccessWait {
  text: string;
  timeoutMs?: number;
}

const FIRST_OBSERVATION_MS = 10_000;
const IMAGE_RETRY_DELAYS_MS = [200, 400];

interface FirstObservation {
  resolved: Awaited<ReturnType<typeof resolveTargets>>;
  preview: Awaited<ReturnType<typeof readNextObservation>>;
  ref: TargetRef | undefined;
  resolveAgain: boolean;
}

function remainingMs(deadline: number): number {
  return Math.max(0, Math.floor(deadline - performance.now()));
}

function currentTarget(ctx: CallContext, ref: TargetRef): boolean {
  return (
    !ctx.signal?.aborted &&
    !ctx.runtime.coordinator.isClosed(ctx.runId) &&
    ctx.runtime.coordinator.target(ctx.runId, ref.id) === ref &&
    ctx.runtime.bindings.get(ref.bindingId)?.revision === ref.bindingRevision
  );
}

function containsText(observation: Observation | undefined, expected: string): boolean {
  if (!observation) return false;
  const normalize = (text: string) => text.normalize('NFC').replace(/\s/gu, '').toLowerCase();
  const wanted = normalize(expected);
  if (!wanted) return false;
  return [
    ...(observation.text ?? []).map((box) => box.text),
    ...observation.elements.flatMap((element) => [element.name ?? '', element.value ?? '']),
  ].some((text) => normalize(text).includes(wanted));
}

/** Only a settled observation missing its image may be read again, never an input or refusal. */
async function initialPreview(
  ctx: CallContext,
  ref: TargetRef,
  deadline: number,
  recoveryDeadline: number,
) {
  let missingImage = false;
  const read = (until: number) => {
    missingImage = false;
    return readNextObservation(ctx, ref, undefined, {
      timeoutMs: remainingMs(until),
      onFailure: ({ errorType }) => {
        missingImage = errorType === 'screenshotMissing' || errorType === 'captureMissing';
      },
    });
  };
  let preview = await read(deadline);
  for (const [index, delayMs] of IMAGE_RETRY_DELAYS_MS.entries()) {
    const until = Math.min(deadline, recoveryDeadline);
    if (!missingImage || !currentTarget(ctx, ref) || remainingMs(until) <= delayMs) break;
    await setTimeout(delayMs, undefined, { signal: ctx.signal });
    if (!currentTarget(ctx, ref) || remainingMs(until) === 0) break;
    auditComputer(ctx, 'access-observation-retry', {
      bindingId: ref.bindingId,
      attempt: index + 1,
      delayMs,
      remainingMs: remainingMs(until),
    });
    preview = await read(until);
  }
  return preview;
}

/** Access is already granted: inability to observe must not undo or misreport that grant. */
async function firstObservation(
  ctx: CallContext,
  bindingId: string,
  deadline: number,
  recoveryDeadline: number,
): Promise<FirstObservation> {
  let current: FirstObservation = {
    resolved: { targets: [], unavailable: [{ bindingId, reason: 'targetUnavailable' }] },
    preview: { nextObservationUnavailable: true },
    ref: undefined,
    resolveAgain: false,
  };
  if (remainingMs(deadline) === 0 || ctx.runtime.coordinator.isClosed(ctx.runId)) return current;
  ctx.signal?.throwIfAborted();
  const bindingRevision = ctx.runtime.bindings.get(bindingId)?.revision;
  const controller = new AbortController();
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, controller.signal]) : controller.signal;
  const scoped = { ...ctx, signal, computer: { ...ctx.computer, bindingIds: [bindingId] } };
  const read = async (): Promise<FirstObservation> => {
    const resolved = await resolveTargets(scoped, remainingMs(deadline));
    signal.throwIfAborted();
    if (
      remainingMs(deadline) === 0 ||
      ctx.runtime.coordinator.isClosed(ctx.runId) ||
      bindingRevision === undefined ||
      ctx.runtime.bindings.get(bindingId)?.revision !== bindingRevision
    )
      return current;
    const target = resolved.targets.find((ref) => ref.bindingId === bindingId);
    const ref = target ? ctx.runtime.coordinator.target(ctx.runId, target.targetRefId) : undefined;
    current = {
      resolved,
      preview: { nextObservationUnavailable: true },
      ref,
      resolveAgain:
        !ref &&
        resolved.unavailable.some(
          (item) => item.bindingId === bindingId && item.reason === 'targetUnavailable',
        ),
    };
    if (!ref || !currentTarget(scoped, ref)) return current;
    const preview = await initialPreview(scoped, ref, deadline, recoveryDeadline);
    signal.throwIfAborted();
    if (remainingMs(deadline) > 0 && currentTarget(scoped, ref)) current = { ...current, preview };
    return current;
  };
  const timer = new AbortController();
  try {
    return await Promise.race([
      read(),
      setTimeout(remainingMs(deadline), undefined, { signal: timer.signal }).then(() => {
        controller.abort();
        auditComputer(ctx, 'access-observation-timeout', { bindingId });
        return { ...current, resolveAgain: false };
      }),
    ]);
  } catch {
    ctx.signal?.throwIfAborted();
    return { ...current, resolveAgain: false };
  } finally {
    timer.abort();
  }
}

/** Wait on the host's existing condition reader, then return a fresh actionable observation. */
export async function accessObservation(ctx: CallContext, bindingId: string, waitFor?: AccessWait) {
  const started = performance.now();
  const deadline = started + (waitFor?.timeoutMs ?? 5000);
  // Entry-text waiting never shortens the first full observation, including timeoutMs: 0.
  const firstDeadline = started + FIRST_OBSERVATION_MS;
  const recoveryDeadline = waitFor ? Math.min(deadline, firstDeadline) : firstDeadline;
  const bindingRevision = ctx.runtime.bindings.get(bindingId)?.revision;
  const hostGeneration = ctx.runtime.coordinator.hostGeneration();
  let current = await firstObservation(ctx, bindingId, firstDeadline, recoveryDeadline);
  if (!waitFor) return { ...current, readiness: undefined };
  // A newly opened app may not have a window yet. Resolve only within the same readiness budget.
  while (
    !current.ref &&
    current.resolveAgain &&
    remainingMs(recoveryDeadline) > 0 &&
    ctx.runtime.bindings.get(bindingId)?.revision === bindingRevision &&
    ctx.runtime.coordinator.hostGeneration() === hostGeneration
  ) {
    await setTimeout(Math.min(200, remainingMs(recoveryDeadline)), undefined, {
      signal: ctx.signal,
    });
    if (
      ctx.runtime.bindings.get(bindingId)?.revision !== bindingRevision ||
      ctx.runtime.coordinator.hostGeneration() !== hostGeneration
    )
      break;
    current = await firstObservation(ctx, bindingId, recoveryDeadline, recoveryDeadline);
  }
  const observation = current.preview.snapshot?.observation;
  const remaining = Math.max(0, Math.floor(deadline - performance.now()));
  if (current.ref && observation && !containsText(observation, waitFor.text) && remaining > 0) {
    try {
      await runAct(ctx, {
        targetRefId: current.ref.id,
        observationRefId: observation.ref.id,
        steps: [
          {
            kind: 'wait',
            condition: { kind: 'textAppears', text: waitFor.text },
            timeoutMs: remaining,
          },
        ],
      });
    } catch {
      ctx.signal?.throwIfAborted();
      // An unsupported condition or stale target still returns the actual latest state.
    }
    current = { ...current, preview: await readNextObservation(ctx, current.ref) };
  }
  const met = containsText(current.preview.snapshot?.observation, waitFor.text);
  const readiness = { met, elapsedMs: Math.round(performance.now() - started) };
  auditComputer(ctx, 'access-readiness', readiness);
  return { ...current, readiness };
}
