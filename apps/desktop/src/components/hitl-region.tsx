import { useTranslation } from 'react-i18next';
import { AppConsentControls } from '../features/apps/app-consent-controls';
import { ApprovalControls } from '../features/agent/transcript/approval-controls';
import { ViewRequestControls } from '../features/agent/generative-views/view-request-controls';
import { QuestionControls } from '../features/agent/transcript/question-block';
import { useContentChangeFade } from '../features/agent/content-feedback';
import type { HitlRequest } from './hitl-request';

/**
 * Urgent region at the top of the composer popover, showing the one request the pager selected.
 * Confirmations resolve with a permission decision (detail embedded truncated with full copy);
 * input questions resolve with a chip, a free-text answer, or skip. Polite live so arrivals and
 * page changes announce without interrupting typing. A lone approval drops its scope title
 * because the popover header already merges it. App consents resolve with Allow or Deny, which
 * Atd remembers for the app. A waiting view is answered in its window, so its part opens it.
 */
export function HitlRegion({
  request,
  focusOnMount,
  hideApprovalTitle = false,
}: {
  request: HitlRequest;
  focusOnMount: boolean;
  hideApprovalTitle?: boolean;
}) {
  const { t } = useTranslation('tasks');
  const feedbackRef = useContentChangeFade<HTMLElement>(request.id);
  const label =
    request.kind === 'input' || request.kind === 'view'
      ? t('permission.waitingAnswer')
      : t('permission.waitingApproval');
  return (
    // A named section carries the implicit region role; no explicit role needed.
    <section ref={feedbackRef} aria-live="polite" aria-label={label} className="hitl-region">
      {request.kind === 'confirmation' ? (
        <ApprovalControls
          key={request.id}
          request={request}
          focusOnMount={focusOnMount}
          hideTitle={hideApprovalTitle}
        />
      ) : request.kind === 'appConsent' ? (
        <AppConsentControls
          key={request.id}
          consent={request.consent}
          focusOnMount={focusOnMount}
        />
      ) : request.kind === 'view' ? (
        <ViewRequestControls
          key={request.id}
          request={request.request}
          focusOnMount={focusOnMount}
        />
      ) : (
        <QuestionControls key={request.id} request={request} focusOnMount={focusOnMount} />
      )}
    </section>
  );
}
