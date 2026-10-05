/**
 * T5 required child bridge (REAL file path). Pi loads this module into every
 * foreground child via the required-extension snapshot. It resolves the
 * child's own task/run/execution identity from the shared registry, fails
 * closed without it, and registers confined tool proxies plus the memory read
 * tools (no writes) and frozen MCP proxies. No re-delegation, role,
 * scheduling or mission tools.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { childBySessionFile, hostForTask, parentForChildCwd } from './registry.js';
import { registerChildTools } from './child-tools.js';

export default function serviceChildBridge(pi: ExtensionAPI): void {
  pi.on('session_start', async (_event, ctx) => {
    const cwd = ctx.cwd;
    const parent = parentForChildCwd(cwd);
    if (!parent)
      throw new Error('Child bridge has no parent identity for this cwd; refusing to start.');
    const host = hostForTask(parent.taskId);
    if (!host) throw new Error('Child bridge has no host record for this task; refusing to start.');
    // Pi emits session_start inside the launch's `create`; the trigger admitted the child under
    // the session file its launch opens before that, so every tool call is this child's own.
    const sessionFile = ctx.sessionManager.getSessionFile();
    const child = sessionFile ? childBySessionFile(parent.sessionId, sessionFile) : null;
    if (!child)
      throw new Error('Child bridge has no admitted child for this session; refusing to start.');
    const { parentRunId, executionId } = child;
    registerChildTools(pi, {
      taskId: parent.taskId,
      parentRunId,
      executionId,
      agent: child.agent,
      cwd: host.cwd,
      dataDir: host.dataDir,
      allowedTools: host.allowedTools,
      resourceIds: host.resourceIds,
      audit: host.audit,
    });
    // Pi only reports a throw from this handler; the trigger runs the child once this is set.
    child.bridged = true;
    // The memory read tools (a child execution never learns) and MCP proxies
    // bind to this child's execution. Both are closures over the service
    // authority singletons, so no second store or second MCP connection layer
    // is ever created inside the child.
    try {
      host.memoryFactory?.({ runId: parentRunId, executionId })(pi);
    } catch {
      // Memory stays unavailable rather than widening to an ad-hoc store.
    }
    try {
      await host.mcpBuilder({ runId: parentRunId, executionId, agent: child.agent })(pi);
    } catch {
      // MCP stays unavailable rather than building a second connection layer.
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
