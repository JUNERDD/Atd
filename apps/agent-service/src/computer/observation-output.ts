import { formatDimensionNote, resizeImage } from '@earendil-works/pi-coding-agent';
import type { Observation } from '@atd/agent-contracts';
import { auditComputer, type CallContext } from './call-context.js';
import { observationFacts } from './details.js';
import type { ComputerSnapshot } from './snapshots.js';
import { visualState } from './visual-qualifications.js';

/**
 * Shared model facts, task resource and actionable capture registration for a fresh read. `visual`
 * tells the model whether it may take capture-point steps; every action runs in the background,
 * so there is one state for the run's model.
 */
export async function observationOutput(
  ctx: CallContext,
  targetRefId: string,
  bindingId: string,
  observation: Observation,
) {
  const { coordinator } = ctx.runtime;
  const targetRef = coordinator.target(ctx.runId, targetRefId);
  const saved = await saveScreenshot(ctx, observation);
  const visual = visualState(ctx.model);
  auditComputer(ctx, 'observe', {
    bindingId,
    screenshot: saved !== null,
    visual,
  });
  const shot = saved && ctx.model.acceptsImages ? observation.screenshot : undefined;
  const resized = shot ? await resizeImage(Buffer.from(shot.base64, 'base64'), shot.mime) : null;
  ctx.signal?.throwIfAborted();
  // Only a capture the model can read may anchor capture points and regions later.
  if (observation.capture && saved)
    ctx.runtime.coordinator.rememberCapture(
      {
        taskId: ctx.taskId,
        runId: ctx.runId,
        targetRefId,
        observationRefId: observation.ref.id,
      },
      observation.capture,
    );
  const note = resized ? formatDimensionNote(resized) : undefined;
  const facts = {
    observation: observationFacts(observation),
    ...(saved ? { screenshot: { ...saved, ...(note ? { note } : {}) } } : {}),
    visual,
    ...(ctx.runtime.visualOverride && visual === 'unverified' ? { visualOverride: true } : {}),
  };
  const image = shot
    ? {
        type: 'image' as const,
        data: resized?.data ?? shot.base64,
        mimeType: resized?.mimeType ?? shot.mime,
      }
    : undefined;
  const snapshot: ComputerSnapshot = {
    observation,
    facts,
    ...(image ? { image } : {}),
    ...(saved ? { resourceId: saved.resourceId } : {}),
  };
  if (
    targetRef &&
    coordinator.target(ctx.runId, targetRefId)?.hostGeneration === targetRef.hostGeneration &&
    !coordinator.isClosed(ctx.runId)
  )
    coordinator.snapshots.remember(ctx.runId, targetRefId, targetRef.hostGeneration, snapshot);
  return {
    facts,
    saved,
    visual,
    snapshot,
    ...(image ? { image } : {}),
  };
}

/**
 * Saves an observation's screenshot as a resource of the task and answers where the read tool
 * finds it again if needed. Image bytes travel as image content, never as JSON facts.
 */
async function saveScreenshot(
  ctx: CallContext,
  observation: Observation,
): Promise<{ resourceId: string; path: string; mime: string } | null> {
  const shot = observation.screenshot;
  if (!shot) return null;
  try {
    const resource = await ctx.resources.save({
      name: `screenshot-${observation.ref.id}.${shot.mime === 'image/png' ? 'png' : 'jpg'}`,
      mime: shot.mime,
      bytes: new Uint8Array(Buffer.from(shot.base64, 'base64')),
      taskId: ctx.taskId,
    });
    return { resourceId: resource.id, path: ctx.resources.pathOf(resource.id), mime: shot.mime };
  } catch (error) {
    ctx.log.warn('A computer screenshot was not saved.', {
      taskId: ctx.taskId,
      error: String(error),
    });
    return null;
  }
}
