import {
  COMPUTER_ENGINE_FOR_KIND,
  COMPUTER_MAX_RUN_BINDINGS,
  type ComputerAccessTarget,
  type ComputerTargetKind,
} from '@atd/agent-contracts';
import {
  auditComputer,
  envelopeFor,
  refuse,
  type CallBase,
  type CallContext,
  type ToolAnswer,
} from './call-context.js';
import { readNextObservation } from './next-observation.js';
import { computerDetails } from './details.js';
import { replyValue, wrongKind, resolveTargets } from './operations.js';

/** The binding kind each access target resolves to. */
const KIND_FOR_TARGET: Readonly<Record<ComputerAccessTarget['kind'], ComputerTargetKind>> = {
  application: 'native',
  website: 'browser',
};

/**
 * Resolve the real target first, then authorize access through the task's existing gate. Access
 * is always background access: the host opens the target without bringing anything forward
 * (`accessOpened.activated` says when opening it made an app active anyway, such as a browser
 * that had to start), and refuses with `noBackgroundRoute` (`openBrowser`) when it cannot.
 */
export async function requestAccess(
  base: CallBase,
  target: ComputerAccessTarget,
  reason: string,
): Promise<ToolAnswer> {
  if (
    base.unattended ||
    base.snapshot.computer?.grant ||
    base.snapshot.computer?.trial ||
    !base.executionId.startsWith('root:')
  )
    refuse(base, 'Only an attended parent task can request new computer access.');
  const { runtime, runId } = base;
  const kind = KIND_FOR_TARGET[target.kind];
  if (!runtime.engineInstalled(COMPUTER_ENGINE_FOR_KIND[kind]))
    refuse(
      base,
      'This target needs an engine that is not installed: the person installs it in Settings → Computer use → Engines, then request access again.',
    );
  const computer = runtime.access.effective(runId, base.snapshot.computer) ?? { bindingIds: [] };
  const ctx: CallContext = { ...base, computer, scope: { ok: true, mode: 'free' } };
  const candidate = replyValue(
    ctx,
    await runtime.coordinator.request(
      envelopeFor(ctx, 30_000),
      { kind: 'prepareAccess', target },
      { signal: ctx.signal, timeoutMs: 30_000 },
    ),
    'requestAccess',
  );
  if (candidate.kind !== 'accessCandidate') wrongKind(ctx, 'requestAccess');
  const { content } = candidate;
  if (content.kind !== kind) refuse(ctx, 'The host resolved a different target kind.');
  let binding = runtime.access.matching(content, runId);
  if (
    (!binding || !computer.bindingIds.includes(binding.bindingId)) &&
    computer.bindingIds.length >= COMPUTER_MAX_RUN_BINDINGS
  )
    refuse(ctx, `A run can access at most ${COMPUTER_MAX_RUN_BINDINGS} computer targets.`);
  const persistent = ctx.tier !== 'manual';
  const reused =
    binding &&
    (runtime.access.inRun(runId, binding) || (persistent && runtime.access.allows(binding)));
  if (!reused) {
    await ctx.gate({
      toolCallId: ctx.toolCallId,
      scope: {
        tool: 'computerAccess',
        target: content,
        persistence: persistent ? 'saved' : 'run',
      },
      title: `Allow computer access to ${content.label}`,
      detail: reason,
      signal: ctx.signal,
      sessionGrant: false,
    });
  }
  try {
    ctx.signal?.throwIfAborted();
    if (
      !binding ||
      (persistent && !runtime.bindings.list().some((b) => b.bindingId === binding?.bindingId))
    )
      binding = persistent
        ? await runtime.bindings.save({ content })
        : runtime.bindings.saveTemporary(runId, content);
    ctx.signal?.throwIfAborted();
    if (!runtime.bindings.matches(binding.bindingId, binding.hash))
      refuse(ctx, 'The target was removed or changed while access was being approved.');
    await runtime.access.allow(runId, binding, persistent);
    ctx.signal?.throwIfAborted();
    if (
      !runtime.bindings.matches(binding.bindingId, binding.hash) ||
      !runtime.access.inRun(runId, binding)
    )
      refuse(ctx, 'The target authorization was revoked.');
    ctx.computer = runtime.access.effective(runId, computer) ?? computer;
    const opened = replyValue(
      ctx,
      await runtime.coordinator.request(
        envelopeFor(ctx, 30_000),
        {
          kind: 'openAccess',
          binding,
          // A manual run reusing a previously saved profile must not delete that profile.
          persistent: runtime.bindings.list().some((b) => b.bindingId === binding?.bindingId),
        },
        { signal: ctx.signal, timeoutMs: 30_000, bindingId: binding.bindingId },
      ),
      'requestAccess',
      binding.bindingId,
    );
    if (opened.kind !== 'accessOpened') wrongKind(ctx, 'requestAccess', binding.bindingId);
    auditComputer(ctx, reused ? 'access-reused' : 'access-approved', {
      bindingId: binding.bindingId,
      hash: binding.hash,
      persistence: persistent ? 'saved' : 'run',
      ...(opened.activated ? { activated: true } : {}),
    });
    const { bindingId } = binding;
    const { resolved, preview } = await firstObservation(ctx, bindingId);
    const { image, resourceId, snapshot, ...observation } = preview;

    return {
      text: JSON.stringify({
        access: {
          bindingId: binding.bindingId,
          label: binding.label,
          persistence: persistent ? 'saved' : 'run',
          // Opening it made an app active anyway (a browser that had to start): the person saw it.
          ...(opened.activated ? { activated: true } : {}),
        },
        ...resolved,
        ...observation,
        next:
          'nextObservation' in preview
            ? 'Inspect the returned nextObservation image and continue directly with act using its targetRefId and observationRefId. No targets or preparatory observe call is needed.'
            : resolved.targets.length
              ? 'Access was approved. The first observation is unavailable; observe the target.'
              : NOT_READY,
      }),
      ...(image ? { image } : {}),
      ...(snapshot ? { snapshot } : {}),
      details: computerDetails({
        op: 'requestAccess',
        bindingId: binding.bindingId,
        target: binding.label,
        resourceIds: resourceId ? [resourceId] : [],
      }),
    };
  } finally {
    // Cancellation may finish while a durable grant write is still pending.
    if (ctx.signal?.aborted) runtime.access.forget(runId);
  }
}

/**
 * Access was approved but no target resolved. The model must not start or show the app itself:
 * that would change what the person has in front of them while they work.
 */
const NOT_READY =
  'Access was approved, but the target is not ready yet. An app that was not running starts in the background and can take a few seconds to show its window: call requestAccess again to continue. Never open, activate or switch to the target yourself, such as with open or AppleScript in a shell: that would bring it in front of the person while they work. If it is still unavailable, tell the person.';

/** Access succeeded already: target resolution or capture failure must not revoke that fact. */
async function firstObservation(ctx: CallContext, bindingId: string) {
  try {
    const resolved = await resolveTargets({
      ...ctx,
      computer: { ...ctx.computer, bindingIds: [bindingId] },
    });
    const target = resolved.targets.find((ref) => ref.bindingId === bindingId);
    const ref = target ? ctx.runtime.coordinator.target(ctx.runId, target.targetRefId) : undefined;
    const preview = ref
      ? await readNextObservation(ctx, ref)
      : { nextObservationUnavailable: true };
    return { resolved, preview };
  } catch {
    return {
      resolved: { targets: [], unavailable: [{ bindingId, reason: 'targetUnavailable' }] },
      preview: { nextObservationUnavailable: true },
    };
  }
}
