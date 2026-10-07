import { createToolSearchExtension, type ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { ConfirmReview, PermissionTier, RunStatus } from '@atd/agent-contracts';
import type { ListMcp, UpsertMcp } from './configure-mcp-tool.js';
import { confirmReview, type Reviewer } from './harness/auto-review.js';
import {
  McpAuthority,
  MCP_RESOURCE_TOOLS,
  type McpGuardedCall,
  type McpPreapproval,
  type McpProxyHost,
  type McpResourceServer,
  type McpToolBinding,
} from './mcp/index.js';
import { mcpServersSection } from './mcp/servers-section.js';
import { ResourceStore } from './resources.js';
import { readServiceId } from './storage.js';
import type { RunnerContext } from './task-runner.js';
import { effectiveTaskTier } from './tasks/tier.js';
import { auditUnattended, isUnattendedRun } from './unattended.js';

/**
 * Pi's tool search (`createToolSearchExtension`). An allowlist names it, which declares it, only
 * when a bound MCP server is deferred. Deferred proxies are allowlisted too, so the search may load
 * them: the parent keeps them undeclared until it does (pi-session.ts `declaredTools`), and a
 * child's session never declares a deferred tool by itself.
 */
const TOOL_SEARCH_TOOL = 'tool_search';

export interface SessionMcpDeps {
  ctx: RunnerContext;
  taskId: string;
  currentRunId: () => string;
  executionId: () => string;
  review: Reviewer;
  audit: (entry: Record<string, unknown>) => void;
  setStatus: (runId: string, status: RunStatus) => void;
}

/** One subagent child: whom its MCP calls belong to, and the tier that decides them. */
export interface McpChildExecution {
  runId: string;
  executionId: string;
  tier: PermissionTier;
}

export interface SessionMcpPrep {
  factory: ExtensionFactory;
  /** The proxies `factory` registers. */
  bindings: McpToolBinding[];
  /** The servers whose resources `factory`'s resource tools reach (mcp/resource-tools.ts). */
  resourceServers: McpResourceServer[];
  /**
   * What these add to a session's allowlist: the proxies, `tool_search` when a server is deferred,
   * and the resource tools when a server's resources are reachable. A subagent child that keeps
   * the task's tools inherits them (subagents/intersection.ts).
   */
  tools: string[];
  /**
   * The same tools for one subagent child (subagents/child-bridge.ts), each call decided and
   * audited as that child, with what the parent's session adds to reach them: the `mcp_servers`
   * section and, for a deferred server, `tool_search`. Both follow the proxies the child's
   * allowlist keeps, so a child that limits its tools gets neither.
   */
  childFactory: (child: McpChildExecution) => ExtensionFactory;
  upsertMcp: UpsertMcp;
  listMcp: ListMcp;
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
  const tier = effectiveTaskTier(deps.ctx.ledger, deps.taskId, deps.ctx.tier);
  const { factory, factoryFor, bindings, resourceServers } = await authority.prepareRunnerTools(
    proxyHost(deps, { runId: deps.currentRunId, executionId: deps.executionId, tier }),
  );
  deps.audit({ taskId: deps.taskId, runId: deps.currentRunId(), mcpTools: bindings.length });
  const deferred = bindings.some((binding) => binding.exposure === 'deferred');
  return {
    factory,
    bindings,
    resourceServers,
    tools: [
      ...bindings.map((binding) => binding.proxyName),
      ...(deferred ? [TOOL_SEARCH_TOOL] : []),
      ...(resourceServers.length ? MCP_RESOURCE_TOOLS : []),
    ],
    childFactory: (child) => {
      const register = factoryFor(
        proxyHost(deps, {
          runId: () => child.runId,
          executionId: () => child.executionId,
          tier: child.tier,
        }),
      );
      return async (pi) => {
        await register(pi);
        // Pi keeps only the tools the child's allowlist names: its agent's tools within the ceiling.
        const kept = new Set(pi.getAllTools().map((tool) => tool.name));
        const reached = bindings.filter((binding) => kept.has(binding.proxyName));
        await mcpServersSection(reached)(pi);
        if (reached.some((binding) => binding.exposure === 'deferred'))
          await createToolSearchExtension()(pi);
      };
    },
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

/** Whose MCP calls a proxy host makes: the session's own runs, or one subagent child. */
export interface McpExecution {
  runId: () => string;
  executionId: () => string;
  tier: PermissionTier;
}

/**
 * The proxy host for one execution: its calls are attributed to it and its tier decides them.
 * While one of its confirms waits, its run shows `awaiting_confirmation`, as the gate's confirms
 * show it (pi-session.ts, subagents/approvals.ts): a child's run is the parent run it belongs to.
 */
function proxyHost(deps: SessionMcpDeps, execution: McpExecution): McpProxyHost {
  return {
    taskId: deps.taskId,
    runId: execution.runId,
    executionId: execution.executionId,
    audit: deps.audit,
    log: deps.ctx.log,
    preapprove: mcpPreapproval(deps, execution),
    setStatus: (status) => deps.setStatus(execution.runId(), status),
  };
}

/** What an MCP preapproval uses of the session's MCP deps. */
export type McpPreapprovalDeps = Pick<SessionMcpDeps, 'taskId' | 'review' | 'audit'> & {
  ctx: Pick<RunnerContext, 'ledger'>;
};

/**
 * The tier's say on an MCP call its server policy guards, frozen with the session as the gate's
 * tier is: `always` runs it, `auto` runs it when the review allows, and anything else leaves it to
 * the per-operation confirm. A child's tier is the stricter of the task's and its agent's
 * (subagents/approvals.ts). An unattended run (unattended.ts) raises no confirm: its refusal says
 * so, and the approval refuses the call at once (mcp/approval.ts). The refusal's `unattended`
 * line lands here, in the run's audit; the authority's own audit is shared by every task. A
 * child's run is its parent run.
 */
export function mcpPreapproval(
  deps: McpPreapprovalDeps,
  execution: McpExecution,
): (call: McpGuardedCall, signal?: AbortSignal) => Promise<McpPreapproval> {
  return async (call, signal) => {
    const base = {
      taskId: deps.taskId,
      runId: execution.runId(),
      executionId: execution.executionId(),
      tool: `mcp:${call.serverId}/${call.tool}`,
      toolCallId: call.toolCallId,
    };
    if (execution.tier === 'always') {
      deps.audit({ ...base, decision: 'tier' });
      return { allowed: true };
    }
    const unattended = isUnattendedRun(deps.ctx.ledger, deps.taskId, base.runId);
    let review: ConfirmReview | undefined;
    if (execution.tier === 'auto') {
      const detail = JSON.stringify({ server: call.serverId, tool: call.tool, args: call.args });
      const verdict = await deps.review({ scope: { tool: 'mcp' }, detail, unattended }, signal);
      deps.audit({ ...base, decision: `review-${verdict.decision}`, reason: verdict.reason });
      if (verdict.decision === 'allow') return { allowed: true };
      review = confirmReview(verdict);
    }
    if (!unattended) return review ? { allowed: false, review } : { allowed: false };
    const title = `MCP ${call.serverId} / ${call.tool}`;
    auditUnattended(deps.audit, { ...base, kind: 'confirm', title });
    return { allowed: false, unattended: true };
  };
}
