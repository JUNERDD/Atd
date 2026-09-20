import { useTranslation } from 'react-i18next';
import type { PermissionRequest } from '../../electron/agent/permission-schema';
import { ApprovalControls } from '../features/agent/transcript/approval-controls';
import { QuestionControls } from '../features/agent/transcript/question-block';

/**
 * Urgent region at the top of the composer popover. Confirmations resolve with a permission
 * decision (detail embedded truncated with full copy); input questions resolve with a chip, a
 * free-text answer, or skip. Polite live so arrivals announce without interrupting typing.
 */
export function HitlRegion({ requests }: { requests: PermissionRequest[] }) {
  const { t } = useTranslation('tasks');
  if (requests.length === 0) return null;
  const label = requests.some((request) => request.kind === 'confirmation')
    ? t('permission.waitingApproval')
    : t('permission.waitingAnswer');
  return (
    // A named section carries the implicit region role; no explicit role needed.
    <section aria-live="polite" aria-label={label} className="hitl-region">
      {requests.map((request) =>
        request.kind === 'confirmation' ? (
          <ApprovalControls key={request.id} request={request} />
        ) : (
          <QuestionControls key={request.id} request={request} />
        ),
      )}
    </section>
  );
}
