/**
 * Memory policy carried by the service authority (D7). The authority owns the
 * paused flag and the policy revision; runners only report their snapshot and
 * execution scope. Child executions never learn, and command materials never
 * become preferences.
 */
export type MemoryTarget = 'memory' | 'user' | 'failure';

export interface MemoryPolicyState {
  paused: boolean;
  version: number;
}

export interface MemoryScope {
  /** The run snapshot's memory toggle. */
  runMemory: boolean;
  /** Root executions learn; child executions only read. */
  executionId: string;
}

export function isChildExecution(executionId: string): boolean {
  return !executionId.startsWith('root:');
}

export function canReadMemory(policy: MemoryPolicyState, scope: MemoryScope): boolean {
  void policy;
  return scope.runMemory;
}

export function canLearnMemory(policy: MemoryPolicyState, scope: MemoryScope): boolean {
  return scope.runMemory && !policy.paused && !isChildExecution(scope.executionId);
}

/**
 * Hermes custom entries that carry command materials. The patched host
 * excludes them from learning; the authority re-checks so a future host
 * cannot silently widen learning scope.
 */
export function isCommandMaterialEntry(entry: {
  type: string;
  customType?: string;
  data?: unknown;
}): boolean {
  if (entry.type !== 'custom' || entry.customType !== 'app-invocation') return false;
  const data = entry.data;
  return typeof data === 'object' && data !== null && 'source' in data && data.source === 'command';
}

export function nextPolicyVersion(policy: MemoryPolicyState): MemoryPolicyState {
  return { paused: policy.paused, version: policy.version + 1 };
}
