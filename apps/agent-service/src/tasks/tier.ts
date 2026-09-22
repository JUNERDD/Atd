import type { PermissionTier } from '@ai/agent-contracts';
import type { Ledger } from '../ledger.js';

/**
 * Effective task tier (T6b). Tasks freeze the service default at creation;
 * PATCH retier applies to runs built after the change (active runs keep
 * their frozen tier; D8 no-hot-swap). Missing tasks fall back so cold paths
 * never throw on a deleted task.
 */
export function effectiveTaskTier(
  ledger: Ledger,
  taskId: string,
  fallback: PermissionTier,
): PermissionTier {
  const task = ledger.data.tasks.find((item) => item.id === taskId);
  return task?.permissionTier ?? fallback;
}
