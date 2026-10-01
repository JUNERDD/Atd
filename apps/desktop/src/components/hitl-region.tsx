import { useTranslation } from 'react-i18next';
import type { PermissionRequest } from '../client/agent/permission-schema';
import { ApprovalControls } from '../features/agent/transcript/approval-controls';
import { QuestionControls } from '../features/agent/transcript/question-block';

/**
 * Urgent region at the top of the composer popover, showing the one request the pager selected.
 * Confirmations resolve with a permission decision (detail embedded truncated with full copy);
 * input questions resolve with a chip, a free-text answer, or skip. Polite live so arrivals and
 * page changes announce without interrupting typing. A lone approval drops its scope title
 * because the popover header already merges it.
 */
export function HitlRegion({
  request,
  focusOnMount,
  hideApprovalTitle = false,
}: {
  request: PermissionRequest;
  focusOnMount: boolean;
  hideApprovalTitle?: boolean;
}) {
  const { t } = useTranslation('tasks');
  const label =
    request.kind === 'confirmation'
      ? t('permission.waitingApproval')
      : t('permission.waitingAnswer');
  return (
    // A named section carries the implicit region role; no explicit role needed.
    <section aria-live="polite" aria-label={label} className="hitl-region">
      {request.kind === 'confirmation' ? (
        <ApprovalControls
          key={request.id}
          request={request}
          focusOnMount={focusOnMount}
          hideTitle={hideApprovalTitle}
        />
      ) : (
        <QuestionControls key={request.id} request={request} focusOnMount={focusOnMount} />
      )}
    </section>
  );
}
