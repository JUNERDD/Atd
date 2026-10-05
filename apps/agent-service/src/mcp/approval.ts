import { errorMessage, mcpCapabilityId, type ConfirmReview } from '@atd/agent-contracts';
import type { ConfirmStore } from '../confirms.js';
import type { Logger } from '../logging.js';
import { matchToolPattern } from './servers.js';

/**
 * Service-claimed MCP approval (D6). Facade tool calls approve per
 * operation through the task ConfirmStore (`allow_once`/`deny`); a `session`
 * answer is downgraded to once and NEVER cached. The facade is the only
 * caller of `tools/call`, so no other path can reach a tool unapproved.
 */

export interface McpApprovalContext {
  taskId: string;
  runId: string;
  executionId: string;
  toolCallId: string;
  serverId: string;
  connectionId: string;
  toolName: string;
  origin: string;
  args: Record<string, unknown>;
  /** What the `auto` tier's review said before this confirm, shown on it. */
  review?: ConfirmReview;
  /** The operation's run status while the confirm waits (`OperationContext.setStatus`). */
  setStatus?: (status: 'awaiting_confirmation' | 'running') => void;
}

export class McpApprovalBroker {
  constructor(
    private readonly confirms: ConfirmStore,
    private readonly audit: (entry: Record<string, unknown>) => void,
    private readonly log: Logger,
  ) {}

  /** Whether a tool call needs a per-op prompt under the server policy. */
  static approvalRequired(
    policy: boolean | string[],
    toolName: string,
    candidates: string[] = [],
  ): boolean {
    if (policy === true) return true;
    if (policy === false || policy.length === 0) return false;
    return matchToolPattern(policy, [toolName, ...candidates]);
  }

  /**
   * Decides one operation via the task confirm channel. Abort propagates
   * (run cancel); expiry and decline both deny without caching. While the
   * confirm waits, the run shows `awaiting_confirmation`, as for the service
   * gate's confirms (harness/gate.ts), and `running` once it settles.
   */
  async decide(ctx: McpApprovalContext, signal?: AbortSignal): Promise<'allow_once' | 'deny'> {
    const capability = mcpCapabilityId(ctx.connectionId, ctx.toolName);
    const base = {
      taskId: ctx.taskId,
      runId: ctx.runId,
      executionId: ctx.executionId,
      tool: capability,
      toolCallId: ctx.toolCallId,
      server: ctx.serverId,
      origin: ctx.origin,
    };
    ctx.setStatus?.('awaiting_confirmation');
    try {
      const answer = await this.confirms.request(
        {
          taskId: ctx.taskId,
          runId: ctx.runId,
          executionId: ctx.executionId,
          toolCallId: ctx.toolCallId,
          kind: 'confirmation',
          // v1.1 mcp scope carries the MCP identity; the server/tool detail
          // rides in title/detail, and no grant is ever cached for MCP.
          scope: { tool: 'mcp' },
          title: `MCP ${ctx.serverId} / ${ctx.toolName}`,
          detail: JSON.stringify({
            server: ctx.serverId,
            tool: ctx.toolName,
            args: ctx.args,
          }).slice(0, 20000),
          ...(ctx.review ? { review: ctx.review } : {}),
        },
        signal,
      );
      if (!('decision' in answer) || answer.decision === 'declined') {
        this.audit({ ...base, decision: 'deny' });
        return 'deny';
      }
      // `session` answers downgrade to once: no shared-session cache, ever.
      this.audit({ ...base, decision: 'allow_once', answered: answer.decision });
      return 'allow_once';
    } catch (error) {
      if (signal?.aborted) throw error;
      this.log.warn('MCP approval lapsed; denying the operation.', {
        server: ctx.serverId,
        tool: ctx.toolName,
        error: errorMessage(error),
      });
      this.audit({ ...base, decision: 'deny', reason: 'lapsed' });
      return 'deny';
    } finally {
      ctx.setStatus?.('running');
    }
  }
}
