import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { QueueState } from '../client/agent/transcript-schema';
import type { HitlStatus } from '../features/agent/progress/progress-pill';
import { scopeKey } from '../features/agent/transcript/permission-copy';
import type { HitlRequest } from './hitl-request';

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
 * What waits on the user, in the labels the regions use: approvals (permission confirms, plans
 * and app consents) win over answers, and the queued count covers a queue alone. A lone request
 * that is an approval or a consent names what it asks for in the title.
 */
export function useHitlSummary(
  requests: readonly HitlRequest[],
  queue: QueueState,
  taskId: string | null,
): HitlSummary {
  const { t } = useTranslation('tasks');
  const { t: tp } = useTranslation('panel');
  const { t: ta } = useTranslation('apps');
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
  const first = requests.length === 1 ? requests[0] : undefined;
  const single = first?.kind === 'confirmation' ? first : null;
  const subject =
    single !== null
      ? t(scopeKey(single.scope))
      : first?.kind === 'appConsent'
        ? ta('consent.title', {
            app: first.consent.appName,
            capability: ta(`capability.${first.consent.capability}.action`),
          })
        : null;
  return {
    status: requests.length > 0 || hasQueue ? { kind, label } : null,
    signature,
    title: subject === null ? label : `${label} · ${subject}`,
    mergedApproval: single !== null,
    hasQueue,
  };
}
