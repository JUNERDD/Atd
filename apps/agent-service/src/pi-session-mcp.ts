import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { ListMcp, UpsertMcp } from './configure-mcp-tool.js';
import { confirmReview, type Reviewer } from './harness/auto-review.js';
import {
  McpAuthority,
  type McpGuardedCall,
  type McpPreapproval,
  type McpToolBinding,
} from './mcp/index.js';
import { ResourceStore } from './resources.js';
import { readServiceId } from './storage.js';
import type { RunnerContext } from './task-runner.js';
import { effectiveTaskTier } from './tasks/tier.js';

export interface SessionMcpDeps {
  ctx: RunnerContext;
  taskId: string;
  currentRunId: () => string;
  executionId: () => string;
  review: Reviewer;
  audit: (entry: Record<string, unknown>) => void;
}

export interface SessionMcpPrep {
  factory: ExtensionFactory;
  /** The proxies `factory` registers. */
  bindings: McpToolBinding[];
  upsertMcp?: UpsertMcp;
  listMcp?: ListMcp;
}

/** Prepares MCP runner tools and the catalog upsert hook for a parent session. */
export async function prepareSessionMcp(deps: SessionMcpDeps): Promise<SessionMcpPrep> {
  const serviceId = await readServiceId(deps.ctx.paths);
  const authority = await McpAuthority.authorityFor({
    serviceId,
    dataDir: deps.ctx.paths.root,
    cwd: deps.ctx.paths.root,
    events: deps.ctx.events,
    confirms: deps.ctx.confirms,
    resources: new ResourceStore(deps.ctx.ledger, deps.ctx.paths),
    log: deps.ctx.log,
  });
  const { factory, bindings } = await authority.prepareRunnerTools({
    taskId: deps.taskId,
    runId: deps.currentRunId,
    executionId: deps.executionId,
    audit: deps.audit,
    log: deps.ctx.log,
    preapprove: mcpPreapproval(deps),
  });
  deps.audit({ taskId: deps.taskId, runId: deps.currentRunId(), mcpTools: bindings.length });
  return {
    factory,
    bindings,
    upsertMcp: async (serverId, request) => {
      const record = await authority.upsert(serverId, request);
      return { record, approval: await authority.launches.state(record) };
    },
    listMcp: () =>
      Promise.all(
        authority.configured().map(async (record) => ({
          record,
          approval: await authority.launches.state(record),
          state: authority.states.get(record.serverId),
        })),
      ),
  };
}

/**
 * The task tier's say on an MCP call its server policy guards, frozen with the session as the
 * gate's tier is: `always` runs it, `auto` runs it when the review allows, and anything else
 * leaves it to the per-operation confirm.
 */
function mcpPreapproval(
  deps: SessionMcpDeps,
): (call: McpGuardedCall, signal?: AbortSignal) => Promise<McpPreapproval> {
  const tier = effectiveTaskTier(deps.ctx.ledger, deps.taskId, deps.ctx.tier);
  return async (call, signal) => {
    const base = {
      taskId: deps.taskId,
      runId: deps.currentRunId(),
      executionId: deps.executionId(),
      tool: `mcp:${call.serverId}/${call.tool}`,
      toolCallId: call.toolCallId,
    };
    if (tier === 'always') {
      deps.audit({ ...base, decision: 'tier' });
      return { allowed: true };
    }
    if (tier !== 'auto') return { allowed: false };
    const detail = JSON.stringify({ server: call.serverId, tool: call.tool, args: call.args });
    const verdict = await deps.review({ scope: { tool: 'mcp' }, detail }, signal);
    deps.audit({ ...base, decision: `review-${verdict.decision}`, reason: verdict.reason });
    return verdict.decision === 'allow'
      ? { allowed: true }
      : { allowed: false, review: confirmReview(verdict) };
  };
}
