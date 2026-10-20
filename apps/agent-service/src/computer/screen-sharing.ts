import {
  COMPUTER_MAX_VISUAL_SOURCES,
  type ScreenContextReply,
  type ScreenShareOperation,
  type ScreenShareReply,
} from '@atd/agent-contracts';
import { serviceEnvelope } from './pending.js';
import { auditComputer, refuse, type CallBase, type ToolAnswer } from './call-context.js';
import type { ComputerCoordinator } from './coordinator.js';
import { computerDetails } from './details.js';
import { outcomeProblem, replyValue, wrongKind } from './operations.js';
import { screenShareFacts } from './screen-state.js';
import { screenVisionAvailable } from './vision-model.js';

export type ScreenCall =
  | { action: 'shareScreen'; reason: string }
  | { action: 'watchScreen'; timeoutMs?: number }
  | { action: 'stopSharing'; sourceId?: string };

/** Sharing uses the system picker, independently of app bindings, add-ons and input permits. */
export async function runScreenSharing(ctx: CallBase, call: ScreenCall): Promise<ToolAnswer> {
  if (
    ctx.unattended ||
    ctx.snapshot.computer?.grant ||
    ctx.snapshot.computer?.trial ||
    !ctx.executionId.startsWith('root:')
  )
    refuse(ctx, 'Screen sharing is available only during an attended parent task.');
  if (
    call.action !== 'stopSharing' &&
    !(await screenVisionAvailable(ctx.runtime.dataDir, ctx.snapshot.model, ctx.model.acceptsImages))
  )
    refuse(
      ctx,
      'Screen sharing needs an image-capable task model or an available visual model in Settings → Computer.',
    );
  const { coordinator } = ctx.runtime;
  const previous = coordinator.screens.get(ctx.taskId, ctx.runId);
  if (
    call.action === 'shareScreen' &&
    (previous?.sources.length ?? 0) >= COMPUTER_MAX_VISUAL_SOURCES
  )
    refuse(ctx, 'Four sources are already shared. Stop one source before adding another.');
  if (call.action === 'watchScreen' && !previous)
    refuse(
      ctx,
      'No screen is shared for this run. Use shareScreen and choose a source in the macOS picker.',
    );
  if (
    call.action === 'stopSharing' &&
    call.sourceId &&
    !previous?.sources.some((source) => source.sourceId === call.sourceId)
  )
    refuse(
      ctx,
      'That source is not shared by this task run. Use a sourceId from its shared sources.',
    );
  const timeoutMs = call.action === 'watchScreen' ? (call.timeoutMs ?? 10_000) : 0;
  const op: ScreenShareOperation =
    call.action === 'shareScreen'
      ? { kind: 'screenShare', mode: 'start' }
      : call.action === 'stopSharing'
        ? {
            kind: 'screenShare',
            mode: 'stop',
            ...(call.sourceId ? { sourceId: call.sourceId } : {}),
          }
        : {
            kind: 'screenShare',
            mode: 'read',
            ...(previous ? { after: previous.sources } : {}),
            timeoutMs,
          };
  const deadlineMs = call.action === 'shareScreen' ? 120_000 : timeoutMs + 5_000;
  const generation = coordinator.hostGeneration();
  const outcome = await coordinator.request(
    screenEnvelope(ctx.taskId, ctx.runId, deadlineMs, ctx.toolCallId),
    op,
    { signal: ctx.signal, timeoutMs: deadlineMs },
  );
  ctx.signal?.throwIfAborted();
  const reply = replyValue(ctx, outcome, call.action);
  if (reply.kind !== 'screenShare') wrongKind(ctx, call.action);
  if (coordinator.isClosed(ctx.runId) || coordinator.hostGeneration() !== generation)
    refuse(
      ctx,
      'Screen sharing ended with this run or its connection. No current screen is available.',
    );
  coordinator.screens.remember(ctx.taskId, ctx.runId, reply);
  auditComputer(ctx, call.action, { state: reply.state });
  return {
    text: JSON.stringify({
      screenSharing: screenShareFacts(reply),
      ...(reply.state === 'ended' && reply.reason === 'cancelled' && previous
        ? {
            stillShared: previous.sources,
            next: 'The additional picker was cancelled. Existing sources remain shared.',
          }
        : { next: screenShareNext(reply) }),
    }),
    details: computerDetails({ op: call.action }),
  };
}

export function screenEnvelope(
  taskId: string,
  runId: string,
  timeoutMs: number,
  toolCallId = 'service:screen-context',
) {
  return {
    ...serviceEnvelope(taskId, runId, 'screen-sharing'),
    toolCallId,
    deadlineAt: new Date(Date.now() + timeoutMs).toISOString(),
  };
}

/** A fresh native read; no image cache can turn an unavailable stream into current pixels. */
export async function readScreenContext(
  coordinator: ComputerCoordinator,
  taskId: string,
  runId: string,
  signal: AbortSignal | undefined,
): Promise<ScreenContextReply | { kind: 'screenContextUnavailable'; message: string } | undefined> {
  const generation = coordinator.hostGeneration();
  const targetRefIds =
    generation === null
      ? []
      : coordinator.snapshots
          .latestTargetRefIds(runId, generation, COMPUTER_MAX_VISUAL_SOURCES)
          .filter((id) => coordinator.target(runId, id) !== undefined);
  const includeShared = coordinator.screens.get(taskId, runId) !== undefined;
  if (!targetRefIds.length && !includeShared) return undefined;
  const outcome = await coordinator.request(
    screenEnvelope(taskId, runId, 5_000),
    { kind: 'screenContext', targetRefIds, includeShared, limit: COMPUTER_MAX_VISUAL_SOURCES },
    { signal, timeoutMs: 5_000 },
  );
  if (signal?.aborted) return undefined;
  if (coordinator.hostGeneration() !== generation || coordinator.isClosed(runId)) return undefined;
  if (targetRefIds.some((id) => coordinator.target(runId, id) === undefined))
    return {
      kind: 'screenContextUnavailable',
      message: 'An observed target was released during the read.',
    };
  if (outcome.kind !== 'reply' || !outcome.reply.ok)
    return { kind: 'screenContextUnavailable', message: outcomeProblem(outcome) };
  const reply = outcome.reply.value;
  if (reply.kind !== 'screenContext')
    return {
      kind: 'screenContextUnavailable',
      message: 'The host returned no current screen context.',
    };
  coordinator.screens.read(taskId, runId, reply.sharedSources, reply.sources);
  return reply;
}

function screenShareNext(reply: ScreenShareReply): string {
  switch (reply.state) {
    case 'sharing':
      return 'Each source is read independently before the next inference, within the image budget; a configured visual model may supply factual observations. Unavailable sources have no current pixels. Use watchScreen for a later shared-picture change; unchanged pixels do not prove activity stopped. Sharing grants no input access: observe an authorized target before acting.';
    case 'ended':
      return `System screen sharing ended (${reply.reason}) and will not restart automatically. Authorized observed targets may still supply context until they are released.`;
  }
}
