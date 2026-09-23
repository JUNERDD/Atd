import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { decideExpansion } from '../skills/expansion.js';
import { skillProfilePaths } from '../skills/profile.js';
import { loadRunSnapshot } from '../skills/versions.js';
import type { ServicePaths } from '../storage.js';

export interface QueueReplaceContext {
  runId: string;
  /** The active run's session; the runner rejects a replace without one. */
  session: AgentSession;
  paths: ServicePaths;
}

/**
 * Follow-up-only queue replace (T6b). Pi exposes clearQueue (both lists) but
 * no follow-up-only removal, so the replace clears once and re-queues the
 * preserved steering messages in order before the new follow-ups. Steering
 * re-queue skips re-validation (frozen snapshot cannot change mid-run); every
 * new follow-up validates like queue() before anything mutates. The service
 * never queues Pi asides/context messages, so the clear drops nothing else.
 */
export async function replaceFollowUps(
  ctx: QueueReplaceContext,
  followUp: string[],
): Promise<{ steering: string[]; followUp: string[] }> {
  const session = ctx.session;
  const profile = skillProfilePaths(ctx.paths.root, ctx.paths.agentDir);
  const snapshot = await loadRunSnapshot(profile, ctx.runId);
  for (const text of followUp) {
    const decision = decideExpansion(text, snapshot, ctx.runId);
    if (decision.isSkillCommand && !decision.allowed)
      throw new Error(
        decision.diagnostics[0]?.message ?? `Skill "${decision.skillName}" is not available.`,
      );
  }
  const preserved = session.clearQueue();
  for (const text of preserved.steering) await session.steer(text);
  for (const text of followUp) await session.followUp(text);
  return {
    steering: [...session.getSteeringMessages()],
    followUp: [...session.getFollowUpMessages()],
  };
}
