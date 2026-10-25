import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import type { ComputerDetails, ComputerFact } from '@atd/agent-contracts';
import type { HarnessDeps } from '../harness/deps.js';
import { auditComputer, type CallBase, type ToolAnswer } from './call-context.js';
import type { ComputerCall } from './calls.js';
import { VERIFIED_COMPLETION_MESSAGE } from './completion-message.js';
import {
  soleComputerCall,
  supplementalFact,
  verifiedActFact,
  verifiedInput,
  type CompletionAct,
  type VerifiedInput,
} from './completion-proof.js';

interface CompletionCandidate {
  base: CallBase;
  call: CompletionAct;
  actionId: string;
  text: string;
  source?: VerifiedInput;
}

function verifiedFact(
  candidate: CompletionCandidate,
  ctx: ExtensionContext,
): ComputerFact | undefined {
  const { base, call, actionId, source } = candidate;
  const condition = call.postcondition;
  if (!condition || condition.kind === 'newText' || condition.kind === 'enabled') return undefined;
  if (source) return supplementalFact(source, base, call, actionId, ctx);
  const fact = verifiedActFact(base, call, actionId);
  return fact?.result?.dispatch === 'settled' ? fact : undefined;
}

/**
 * Uses Pi's normal tool-batch termination. A queued steer/follow-up still gets its next turn;
 * only final settlement may publish the model's conditional answer, after its real tool result.
 */
export function computerCompletion(deps: HarnessDeps, pi: ExtensionAPI) {
  let candidate: CompletionCandidate | undefined;
  let previous: VerifiedInput | undefined;
  const active = (base: CallBase, ctx: ExtensionContext) =>
    !base.signal?.aborted &&
    !ctx.signal?.aborted &&
    !ctx.hasPendingMessages() &&
    !deps.runner.deleted() &&
    !deps.runner.stopRequested() &&
    deps.runner.currentRunId() === base.runId &&
    !base.runtime.coordinator.isClosed(base.runId);

  pi.on('input', () => {
    previous = undefined;
    candidate = undefined;
  });
  pi.on('turn_start', () => {
    candidate = undefined;
  });
  pi.on('agent_settled', (event, ctx) => {
    const completed = candidate;
    candidate = undefined;
    previous = undefined;
    if (event.aborted || !completed || !active(completed.base, ctx)) return;
    const fact = verifiedFact(completed, ctx);
    if (!fact || !soleComputerCall(ctx, completed.base.toolCallId)) return;
    if (completed.source)
      auditComputer(completed.base, 'verified-completion', {
        actionId: completed.actionId,
        sourceActionId: completed.source.actionId,
        afterObservationRef: completed.source.afterRef.id,
      });
    pi.sendMessage(
      {
        customType: VERIFIED_COMPLETION_MESSAGE,
        content: completed.text,
        display: true,
        details: {
          runId: completed.base.runId,
          toolCallId: completed.base.toolCallId,
          actionId: completed.actionId,
          verifiedAt: fact.at,
          condition: fact.verification?.condition,
        },
      },
      { triggerTurn: false },
    );
    deps.reproject();
  });

  return (
    base: CallBase,
    call: ComputerCall,
    answer: ToolAnswer,
    ctx: ExtensionContext,
  ): AgentToolResult<ComputerDetails> => {
    const source = previous;
    previous = undefined;
    candidate = undefined;
    const result: AgentToolResult<ComputerDetails> = {
      content: [{ type: 'text', text: answer.text }, ...(answer.image ? [answer.image] : [])],
      details: answer.details,
    };
    if (
      call.action !== 'act' ||
      base.unattended ||
      base.snapshot.computer?.grant ||
      base.snapshot.computer?.trial ||
      base.executionId !== `root:${base.runId}` ||
      !answer.details.actionId ||
      answer.details.error ||
      answer.details.blockedBy?.length ||
      !soleComputerCall(ctx, base.toolCallId) ||
      !active(base, ctx)
    )
      return result;
    previous = verifiedInput(base, call, answer, ctx);
    const text = call.completion?.trim();
    if (!text || text === 'null') return result;
    const supplemental =
      source && supplementalFact(source, base, call, answer.details.actionId, ctx)
        ? source
        : undefined;
    if (!supplemental && answer.snapshot?.observation.ref.targetRefId !== call.targetRefId)
      return result;
    const next: CompletionCandidate = {
      base,
      call,
      actionId: answer.details.actionId,
      text,
      ...(supplemental ? { source: supplemental } : {}),
    };
    if (!verifiedFact(next, ctx)) return result;
    candidate = next;
    return { ...result, terminate: true };
  };
}
