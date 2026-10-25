import { Type } from 'typebox';
import { Compile } from 'typebox/compile';
import {
  ComputerActionIdSchema,
  ComputerConditionSchema,
  Identifier,
  type ServiceBlock,
} from '@atd/agent-contracts';
import type { ServiceBranchItem } from '../transcript-branch.js';

export const VERIFIED_COMPLETION_MESSAGE = 'app-computer-verified-completion';
const Details = Compile(
  Type.Object(
    {
      runId: Identifier,
      toolCallId: Type.String({ minLength: 1 }),
      actionId: ComputerActionIdSchema,
      verifiedAt: Type.String(),
      condition: ComputerConditionSchema,
    },
    { additionalProperties: false },
  ),
);

type CompletionMessage = Pick<
  Extract<ServiceBranchItem, { type: 'custom_message' }>,
  'customType' | 'content' | 'display' | 'details'
> & { timestamp: number | string };

/** Only a visible, bounded completion belonging to its enclosing run is conversation prose. */
export function readVerifiedCompletion(item: CompletionMessage, runId: string | undefined) {
  const timestamp =
    typeof item.timestamp === 'string' ? Date.parse(item.timestamp) : item.timestamp;
  if (
    item.customType !== VERIFIED_COMPLETION_MESSAGE ||
    item.display !== true ||
    typeof item.content !== 'string' ||
    !item.content.trim() ||
    item.content.length > 1000 ||
    !Details.Check(item.details) ||
    item.details.runId !== runId ||
    item.details.condition.kind === 'newText' ||
    item.details.condition.kind === 'enabled' ||
    !Number.isFinite(timestamp)
  )
    return undefined;
  return { text: item.content, runId: item.details.runId, timestamp };
}

/** A host-verified conditional answer has no invented model message, timing or token usage. */
export function verifiedCompletionBlock(
  item: Extract<ServiceBranchItem, { type: 'custom_message' }>,
  runId: string,
): ServiceBlock | undefined {
  const completion = readVerifiedCompletion(item, runId);
  if (!completion) return undefined;
  return {
    kind: 'assistant',
    id: `computer-completion:${item.entryId}`,
    runId,
    timestamp: completion.timestamp,
    endedAt: completion.timestamp,
    text: completion.text,
    streaming: false,
    stopReason: 'stop',
    error: '',
  };
}
