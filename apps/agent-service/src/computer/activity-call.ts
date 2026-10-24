import type {
  ComputerActivityProblem,
  ComputerActivityTarget,
  ComputerDetails,
  TargetBindingContent,
} from '@atd/agent-contracts';
import { ComputerRefusal, type CallBase } from './call-context.js';
import type { ComputerCall } from './calls.js';
import { stepSummary } from './details.js';

/** Copy only display identity, while temporary access bindings still exist. */
export function activityTarget(
  content: TargetBindingContent,
  bindingId?: string,
): ComputerActivityTarget {
  const base = { label: content.label, ...(bindingId ? { bindingId } : {}) };
  return content.kind === 'native'
    ? {
        ...base,
        kind: 'native',
        appName: content.appName,
        bundleId: content.bundleId,
        appPath: content.appPath,
      }
    : { ...base, kind: 'browser' };
}

export function beginComputerActivity(base: CallBase, call: ComputerCall): void {
  const ref =
    'targetRefId' in call
      ? base.runtime.coordinator.target(base.runId, call.targetRefId)
      : undefined;
  const binding = ref && base.runtime.bindings.get(ref.bindingId);
  const target =
    binding && binding.revision === ref?.bindingRevision
      ? activityTarget(binding, binding.bindingId)
      : undefined;
  // A multi-step call has no current-step index: do not keep calling its first step current.
  const step = call.action === 'act' && call.steps.length === 1 ? call.steps[0] : undefined;
  base.runtime.activity.begin(base, {
    fromCommand: base.snapshot.fromCommand === true,
    operation: {
      op: call.action,
      ...(step ? { stepKind: step.kind, summary: stepSummary(step) } : {}),
    },
    ...(target ? { target } : {}),
  });
}

export function finishComputerActivity(base: CallBase, details: ComputerDetails): void {
  const completed = details.result?.completedSteps ?? details.steps.length;
  const step = details.steps[Math.max(0, Math.min(completed, details.steps.length) - 1)];
  const error = details.error ?? details.result?.error;
  const unconfirmed = details.result?.effect === 'unknown' || details.result?.effect === 'partial';
  const problem = error
    ? boundedProblem(error)
    : details.blockedBy?.length || unconfirmed
      ? { code: 'unconfirmedOutcome', message: 'An operation outcome needs to be checked.' }
      : undefined;
  base.runtime.activity.end(base, {
    ...(step ? { step } : {}),
    ...(problem ? { problem } : {}),
  });
}

export function failComputerActivity(base: CallBase, error: unknown): void {
  if (base.signal?.aborted) {
    base.runtime.activity.end(base, {});
    return;
  }
  let problem: ComputerActivityProblem;
  if (error instanceof ComputerRefusal)
    problem = boundedProblem(error.error ?? { code: 'refused', message: error.message });
  else
    problem = {
      code: 'failed',
      message: 'The computer operation failed. Open the task for details.',
    };
  base.runtime.activity.end(base, {
    problem,
  });
}

function boundedProblem(problem: {
  code: string;
  reason?: string;
  message: string;
}): ComputerActivityProblem {
  return {
    code: problem.code.slice(0, 128),
    ...(problem.reason ? { reason: problem.reason.slice(0, 128) } : {}),
    message: problem.message.slice(0, 500),
  };
}
