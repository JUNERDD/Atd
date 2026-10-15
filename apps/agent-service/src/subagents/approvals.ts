import { subagentTier, type PermissionTier } from '@atd/agent-contracts';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import { createGate, type Gate } from '../harness/gate.js';
import type { SessionFactoryDeps } from '../pi-session.js';
import { effectiveTaskTier } from '../tasks/tier.js';
import {
  collectPermissionLookups,
  type PermissionLookup,
  type PermissionLookups,
} from '../transcript-blocks.js';
import { fromServiceBranch } from '../transcript.js';
import { isUnattendedRun } from '../unattended.js';
import type { RuntimeAgent } from './agents.js';

/**
 * The parent's approval rules as one child sees them: the tier it runs under and the service gate
 * (harness/gate.ts) over the parent's confirms, session grants, audit and session, with confirms
 * attributed to the child's execution id.
 */
export interface ChildApprovals {
  tier: PermissionTier;
  gate: Gate;
}

/** One child execution asking for its approvals; `agent` is its runtime agent name. */
export interface ChildApprovalsRequest {
  runId: string;
  executionId: string;
  agent: string;
}

/**
 * The parent's approval rules for its children: the task tier the parent session froze (pi-session
 * builds its tool host with the same `effectiveTaskTier`), made stricter by the child agent's own
 * approval from Settings (`RuntimeAgent.approval`), and one gate per child execution over the
 * parent's confirms, session grants, audit and session entries. Child confirms carry the child's
 * execution id, which the desktop labels as a subtask; while one waits, the parent run shows
 * `awaiting_confirmation`, as for the parent's own confirms. An agent without an approval of its
 * own keeps the task tier.
 */
export function childApprovals(
  deps: SessionFactoryDeps,
  sessions: SessionManager,
  agents: readonly RuntimeAgent[],
): (child: ChildApprovalsRequest) => ChildApprovals {
  const taskTier = effectiveTaskTier(deps.ctx.ledger, deps.taskId, deps.ctx.tier);
  const approvals = new Map(agents.map((agent) => [agent.name, agent.approval]));
  return (child) => {
    const tier = subagentTier(taskTier, approvals.get(child.agent) ?? null);
    return {
      tier,
      gate: createGate({
        taskId: deps.taskId,
        runId: () => child.runId,
        executionId: () => child.executionId,
        tier,
        grants: deps.grants,
        review: deps.review,
        // A child's run is its parent run: an unattended parent's children are unattended too.
        unattended: () => isUnattendedRun(deps.ctx.ledger, deps.taskId, child.runId),
        sessions,
        confirms: deps.ctx.confirms,
        audit: deps.audit,
        setStatus: (status) => deps.setStatus(child.runId, status),
      }),
    };
  };
}

/**
 * The parent branch's permission outcomes, which every child reprojection reads. Pi moves the
 * leaf with each entry it appends and each branch switch, and entries never change once
 * appended, so the outcomes are collected again only when the leaf moved.
 */
export function parentPermissionLookups(
  sessions: SessionManager,
): () => ReadonlyMap<string, PermissionLookup> {
  let cached: { leafId: string | null; lookups: PermissionLookups } | undefined;
  return () => {
    const leafId = sessions.getLeafId();
    if (cached?.leafId !== leafId)
      cached = {
        leafId,
        lookups: collectPermissionLookups(fromServiceBranch(sessions.getBranch())),
      };
    return cached.lookups;
  };
}
