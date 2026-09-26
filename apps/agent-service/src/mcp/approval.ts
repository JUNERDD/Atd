import { errorMessage, mcpCapabilityId, type ConfirmReview } from '@ai/agent-contracts';
import type { ConfirmStore } from '../confirms.js';
import type { Logger } from '../logging.js';
import type { AdapterApprovalRequest } from './adapter-types.js';
import { matchToolPattern } from './servers.js';

/**
 * Service-claimed MCP approval (D6). Facade tool calls approve per
 * operation through the task ConfirmStore (`allow_once`/`deny`); a `session`
 * answer is downgraded to once and NEVER cached. Stray adapter approval
 * events (gateway/direct paths the facade never uses) are claimed and
 * denied so nothing falls back to a shared-session cache.
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
}

/** Minimal event-bus surface the broker subscribes to. */
export interface ApprovalBus {
  on(event: string, handler: (request: unknown) => void): () => void;
}

export class McpApprovalBroker {
  private detachBus: (() => void) | null = null;

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
   * (run cancel); expiry and decline both deny without caching.
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
    }
  }

  /**
   * Claims every adapter approval event and denies it: the facade approves
   * before reaching adapter execution, so bus arrivals are strays that must
   * never consult the session cache or an interactive fallback.
   */
  attachBus(bus: ApprovalBus | null, approvalEvent: string): void {
    this.detach();
    if (!bus) return;
    this.detachBus = bus.on(approvalEvent, (request: unknown) => {
      const narrowed = narrowApprovalRequest(request);
      if (!narrowed) return;
      const claimed = narrowed.claim(() => Promise.resolve('deny' as const));
      this.audit({
        tool: mcpCapabilityId(narrowed.serverName, narrowed.originalToolName),
        toolCallId: narrowed.requestId,
        server: narrowed.serverName,
        origin: narrowed.origin,
        decision: 'deny',
        reason: claimed ? 'stray-claimed' : 'claim-raced',
      });
      if (!claimed) {
        this.log.warn('A stray MCP approval was already claimed; served deny by audit.', {
          server: narrowed.serverName,
          tool: narrowed.originalToolName,
        });
      }
    });
  }

  detach(): void {
    this.detachBus?.();
    this.detachBus = null;
  }
}

function narrowApprovalRequest(value: unknown): AdapterApprovalRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record['requestId'] !== 'string' ||
    typeof record['serverName'] !== 'string' ||
    typeof record['originalToolName'] !== 'string' ||
    typeof record['claim'] !== 'function'
  ) {
    return null;
  }
  return {
    requestId: record['requestId'],
    serverName: record['serverName'],
    originalToolName: record['originalToolName'],
    prefixedToolName:
      typeof record['prefixedToolName'] === 'string'
        ? record['prefixedToolName']
        : record['originalToolName'],
    args: (record['args'] ?? {}) as Record<string, unknown>,
    origin: typeof record['origin'] === 'string' ? record['origin'] : 'proxy',
    ...(record['signal'] instanceof AbortSignal ? { signal: record['signal'] } : {}),
    claim: record['claim'] as AdapterApprovalRequest['claim'],
  };
}
