import type { QueueState } from '@atd/agent-contracts';
import { normalizeDraft, type ComposerDraft } from './draft';

/** Append only the messages the service actually withdrew, preserving the draft's valid chips. */
export function restoreQueue(draft: ComposerDraft, unsent: QueueState): ComposerDraft {
  const messages = [...unsent.steering, ...unsent.followUp];
  if (!messages.length) return draft;
  const incoming = messages.join('\n');
  const text = draft.text.trim() ? `${draft.text}\n${incoming}` : incoming;
  return normalizeDraft({ ...draft, text });
}
