import { setTimeout } from 'node:timers/promises';
import type { ComputerObserveInclude, ComputerObserveRegion } from '@atd/agent-contracts';
import { envelopeFor, refuse, type CallContext, type ToolAnswer } from './call-context.js';
import { rectInCapture } from './captures.js';
import { computerDetails } from './details.js';
import { replyValue, wrongKind } from './operations.js';
import { observationOutput } from './observation-output.js';

const OBSERVE_TIMEOUT_MS = 30_000;

/** What one `observe` asks for: the surface (absent: the root window), what to collect, a region. */
export interface ObserveRequest {
  targetRefId: string;
  surfaceRefId?: string | undefined;
  include: ComputerObserveInclude;
  region?: ComputerObserveRegion | undefined;
  afterMs?: number | undefined;
}

/**
 * `observe`: reads a target now. A screenshot is sent inline to image-capable models and saved,
 * and its capture is remembered so later capture points and regions can be checked against it.
 * The facts tell the model whether it may take visual steps (`visual`).
 */
export async function runObserve(ctx: CallContext, request: ObserveRequest): Promise<ToolAnswer> {
  const { coordinator, bindings } = ctx.runtime;
  const { include, region } = request;
  if (!include.tree && !include.screenshot)
    refuse(ctx, 'observe needs the tree, a screenshot or both.');
  if (include.text && !include.screenshot) refuse(ctx, 'observe text needs a screenshot.');
  const targetRef = coordinator.target(ctx.runId, request.targetRefId);
  if (!targetRef) refuse(ctx, 'Unknown or outdated targetRefId: call targets again.');
  const known = { bindingId: targetRef.bindingId };
  if (!ctx.runtime.engineInstalled(targetRef.engine))
    refuse(ctx, 'The target engine was removed. Install its add-on and call targets again.', known);
  if (!ctx.computer.bindingIds.includes(targetRef.bindingId))
    refuse(ctx, 'That target is not one this run may use.', known);
  const binding = bindings.get(targetRef.bindingId);
  if (binding?.revision !== targetRef.bindingRevision)
    refuse(ctx, 'The target changed since it was resolved: call targets again.', known);
  if (region) {
    if (!include.screenshot) refuse(ctx, 'observe region needs a screenshot.', known);
    const capture = coordinator.capture(ctx.runId, targetRef.id, region.capture);
    if (!capture)
      refuse(ctx, `Capture ${region.capture} is not one this run observed of this target.`, known);
    if (!rectInCapture(capture, region.rect))
      refuse(
        ctx,
        `The region lies outside capture ${region.capture} (${capture.width}×${capture.height} pixels).`,
        known,
      );
  }
  if (request.afterMs) await setTimeout(request.afterMs, undefined, { signal: ctx.signal });
  const outcome = await coordinator.request(
    envelopeFor(ctx, OBSERVE_TIMEOUT_MS),
    {
      kind: 'observe',
      targetRef,
      ...(request.surfaceRefId ? { surfaceRefId: request.surfaceRefId } : {}),
      include,
      ...(region ? { region } : {}),
    },
    { signal: ctx.signal, timeoutMs: OBSERVE_TIMEOUT_MS },
  );
  const value = replyValue(ctx, outcome, 'observe', binding.bindingId);
  if (value.kind !== 'observation') wrongKind(ctx, 'observe', binding.bindingId);
  const output = await observationOutput(ctx, targetRef.id, binding.bindingId, value.observation);
  return {
    text: JSON.stringify(output.facts),
    snapshot: output.snapshot,
    ...(output.image ? { image: output.image } : {}),
    details: computerDetails({
      op: 'observe',
      target: binding.label,
      bindingId: binding.bindingId,
      visual: output.visual,
      resourceIds: output.saved ? [output.saved.resourceId] : [],
    }),
  };
}
