/**
 * T5 required child bridge (REAL file path). Pi loads this module into every
 * foreground child via the required-extension snapshot. It resolves
 * root/task/session identity from the shared registry, fails closed without
 * it, and registers confined tool proxies plus memory search (no learn) and
 * frozen MCP proxies. No re-delegation, role, scheduling or mission tools.
 */

import { childBySession, hostForTask, parentForChildCwd } from './registry.js';
import { registerChildTools } from './child-tools.js';

interface BridgePi {
  on(
    event: 'session_start',
    handler: (
      event: unknown,
      ctx: { cwd: string; sessionManager: { getSessionId(): string | undefined } },
    ) => void,
  ): void;
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute: (
      id: string,
      args: unknown,
      signal?: AbortSignal,
    ) => Promise<{ content: { type: string; text: string }[]; details: unknown }>;
  }): void;
  on(
    event: 'tool_call',
    handler: (event: { toolName: string }) => { block?: boolean; reason?: string } | undefined,
  ): void;
}

export default function serviceChildBridge(pi: BridgePi): void {
  pi.on('session_start', (_event, ctx) => {
    const cwd = ctx.cwd;
    const parent = parentForChildCwd(cwd);
    if (!parent)
      throw new Error('Child bridge has no parent identity for this cwd; refusing to start.');
    const host = hostForTask(parent.taskId);
    if (!host) throw new Error('Child bridge has no host record for this task; refusing to start.');
    const childSessionId = ctx.sessionManager.getSessionId() ?? '';
    const tracked = childSessionId ? childBySession(childSessionId) : null;
    const executionId = tracked?.executionId ?? `child:${parent.runId}:0`;
    const parentRunId = tracked?.parentRunId ?? parent.runId;
    registerChildTools(pi, {
      taskId: parent.taskId,
      parentRunId,
      executionId,
      cwd: host.cwd,
      dataDir: host.dataDir,
      allowedTools: host.allowedTools,
      resourceIds: host.resourceIds,
      audit: host.audit,
    });
    // Memory search arrives from the service singleton factory (child scope
    // pins canLearn false); MCP proxies bind per child execution id. Both are
    // closures over the service authority singletons, so no second store or
    // second adapter is ever created inside the child.
    try {
      host.memoryFactory?.(pi);
    } catch {
      // Search stays unavailable rather than widening to an ad-hoc store.
    }
    try {
      host.mcpBuilder?.(executionId)?.(pi);
    } catch {
      // MCP stays unavailable rather than loading a second adapter.
    }
    host.audit({
      taskId: parent.taskId,
      runId: parentRunId,
      executionId,
      tool: 'service.child-bridge',
      decision: 'start',
    });
  });
}
