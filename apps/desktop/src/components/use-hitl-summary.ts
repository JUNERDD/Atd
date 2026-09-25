import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PermissionRequest } from '../../electron/agent/permission-schema';
import type { QueueState } from '../../electron/agent/transcript-schema';
import type { HitlStatus } from '../features/agent/progress/progress-pill';
import { scopeKey } from '../features/agent/transcript/tool-copy';

export interface HitlSummary {
  /** The pill's HITL part; null when nothing waits. */
  status: HitlStatus | null;
  /** Changes whenever the requests or the queue do. */
  signature: string;
  /** The panel header: the status label, plus the scope of a lone approval. */
  title: string;
  /** A lone approval whose scope the title carries, so its own title hides. */
  mergedApproval: boolean;
  hasQueue: boolean;
}

/**
 * What waits on the user, in the labels the regions use: approvals (permission confirms and
 * plans) win over answers, and the queued count covers a queue alone.
 */
export function useHitlSummary(
  requests: readonly PermissionRequest[],
  queue: QueueState,
  taskId: string | null,
): HitlSummary {
  const { t } = useTranslation('tasks');
  const { t: tp } = useTranslation('panel');
  const signature = useMemo(
    () => `${requests.map((request) => request.id).join(',')}|${JSON.stringify(queue)}`,
    [requests, queue],
  );
  const queueCount = queue.steering.length + queue.followUp.length;
  const hasQueue = taskId !== null && queueCount > 0;
  const approval = requests.some((request) => request.kind !== 'input');
  const label =
    requests.length === 0
      ? tp('composer.queuedCount', { count: queueCount })
      : approval
        ? t('permission.waitingApproval')
        : t('permission.waitingAnswer');
  const kind: HitlStatus['kind'] =
    requests.length === 0 ? 'queue' : approval ? 'approval' : 'answer';
  const first = requests[0];
  const single = requests.length === 1 && first?.kind === 'confirmation' ? first : null;
  return {
    status: requests.length > 0 || hasQueue ? { kind, label } : null,
    signature,
    title: single === null ? label : `${label} · ${t(scopeKey(single.scope))}`,
    mergedApproval: single !== null,
    hasQueue,
  };
}
