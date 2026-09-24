import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { ConflictError } from '../errors.js';

/**
 * Follow-up-only queue replace (T6b). Pi exposes clearQueue (both lists) but
 * no follow-up-only removal, so the replace clears once and re-queues the
 * preserved steering messages in order before the new follow-ups. Queued
 * text is plain input: the session loads no skills, so `/skill:` text is sent
 * as written. The clear also drops a custom message queued on the agent; the
 * service queues one only to steer re-attached skills into an overflow retry
 * (skills/session-skills.ts), which that retry takes as soon as it starts.
 *
 * A replace only removes or reorders what is still queued. The client sends
 * the list it last saw, so an entry Pi delivered in the meantime would come
 * back and be sent twice; such a list is refused instead.
 */
export async function replaceFollowUps(
  session: AgentSession,
  followUp: string[],
): Promise<{ steering: string[]; followUp: string[] }> {
  if (!withinQueue(followUp, session.getFollowUpMessages()))
    throw new ConflictError('The queue changed before this edit. Try again.');
  const preserved = session.clearQueue();
  for (const text of preserved.steering) await session.steer(text);
  for (const text of followUp) await session.followUp(text);
  return {
    steering: [...session.getSteeringMessages()],
    followUp: [...session.getFollowUpMessages()],
  };
}

/** Whether every entry of `next` is still queued, counting repeated texts. */
function withinQueue(next: readonly string[], queued: readonly string[]): boolean {
  const left = new Map<string, number>();
  for (const text of queued) left.set(text, (left.get(text) ?? 0) + 1);
  for (const text of next) {
    const count = left.get(text) ?? 0;
    if (count === 0) return false;
    left.set(text, count - 1);
  }
  return true;
}
