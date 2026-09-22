import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { MemoryAuthority } from './authority.js';

/**
 * Runner-side memory proxies (D7). Proxies register no stores of their own;
 * every tool call and learn/flush notification delegates to the singleton
 * MemoryAuthority, which owns the Hermes Store/DatabaseManager pair.
 */
export interface RunnerMemoryScope {
  runMemory: boolean;
  executionId: string;
  taskId: string;
  runId: string;
}

/** Root runner proxy: search plus policy-gated learning tools. */
export function rootMemoryProxy(
  authority: MemoryAuthority,
  scope: RunnerMemoryScope,
): ExtensionFactory {
  if (!scope.executionId.startsWith('root:'))
    throw new Error('Root memory proxy requires a root execution id.');
  return authority.extensionFor({
    runMemory: scope.runMemory,
    executionId: scope.executionId,
    taskId: scope.taskId,
  });
}

/**
 * Child runner proxy: search stays available, learning is always disabled.
 * The authority enforces this even if a caller passes a root-looking scope
 * through the wrong proxy: child proxies pin canLearn to false by wrapping
 * the execution id.
 */
export function childMemoryProxy(
  authority: MemoryAuthority,
  scope: RunnerMemoryScope,
): ExtensionFactory {
  return authority.extensionFor({
    runMemory: scope.runMemory,
    executionId: `child:${scope.runId}`,
    taskId: scope.taskId,
  });
}

/**
 * Runs one model turn's memory work through the authority policy gate.
 * Used by the root runner around prompt/flush; children never call it.
 */
export function runRootMemoryOperation<T>(
  authority: MemoryAuthority,
  scope: RunnerMemoryScope,
  action: () => Promise<T>,
): Promise<T> {
  return authority.runRootOperation(
    { runMemory: scope.runMemory, executionId: scope.executionId },
    action,
  );
}
