import { CircleAlert, KeyRound, PlugZap, ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import {
  ExtensionDetailFields,
  ExtensionDetailSection,
  ExtensionDetailStatus,
  type DetailField,
} from './extension-detail-fields';
import type { ExtensionMcpRow } from './extension-rows';
import { canConfirmMcpApproval } from './use-service-mcp';
import {
  mcpCanConnect,
  mcpNeedsApproval,
  mcpNeedsAuth,
  useMcpApprovalLabel,
  useMcpStateLabel,
} from './use-mcp-state-label';

/**
 * The live side of a server: its state, launch approval, what it offers and its last error, with
 * the step its state calls for: Connect, Authenticate, or Review and allow, which opens the host's
 * native dialog listing what would run. An approved server offers to withdraw the approval. The
 * row is absent until the status list has it. A step's result shows in the state; a failed step
 * says why under the steps. While a step runs, the buttons keep their focus but ignore presses.
 */
export function McpStatusSection({
  row,
  disabled,
  pending,
  issue,
  onConnect,
  onAuthStart,
  onRequestApproval,
  onWithdrawApproval,
}: {
  row: ExtensionMcpRow | undefined;
  /** No service to reach: the steps cannot work at all. */
  disabled: boolean;
  /** A step for this server is running. */
  pending: boolean;
  /** Why the server's last step failed, until its next one. */
  issue: string | null;
  onConnect: () => void;
  onAuthStart: () => void;
  onRequestApproval: () => void;
  onWithdrawApproval: () => void;
}) {
  const { t } = useTranslation('settings');
  const stateLabel = useMcpStateLabel();
  const approvalLabel = useMcpApprovalLabel();
  const label = t('extensions.mcpPage.statusSection');
  if (!row)
    return (
      <ExtensionDetailSection label={label}>
        <ExtensionDetailStatus text={t('extensions.detailLoading')} error={false} />
      </ExtensionDetailSection>
    );
  const approval = approvalLabel(row.approval);
  const fields: DetailField[] = [
    { label: t('extensions.mcpPage.state'), value: stateLabel(row.state) },
    ...(approval ? [{ label: t('extensions.mcpApproval.label'), value: approval }] : []),
    {
      label: t('extensions.detailOffers'),
      value: t('extensions.mcpOffers', {
        tools: row.toolCount,
        resources: row.resourceCount,
        prompts: row.promptCount,
      }),
    },
    ...(row.lastError ? [{ label: t('extensions.detailLastError'), value: row.lastError }] : []),
  ];
  const showReview = mcpNeedsApproval(row.approval);
  // A launch waiting for approval would only be refused, so Review comes before Connect.
  const showConnect = mcpCanConnect(row.state) && !showReview;
  const showAuth = mcpNeedsAuth(row.state);
  const showWithdraw = row.approval === 'approved';
  const canReview = canConfirmMcpApproval();
  // Busy buttons stay focusable (`aria-disabled`, `aria-busy`) and drop presses until the step ends.
  const busyProps = {
    'aria-disabled': pending || undefined,
    'aria-busy': pending || undefined,
    className: 'aria-disabled:opacity-50',
  };
  const run = (action: () => void) => () => {
    if (!pending) action();
  };
  return (
    <ExtensionDetailSection label={label}>
      <ExtensionDetailFields fields={fields} />
      {showConnect || showAuth || showReview || showWithdraw ? (
        <div className="flex flex-wrap items-center gap-2">
          {showReview ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || !canReview}
              {...busyProps}
              onClick={run(onRequestApproval)}
            >
              <ShieldCheck data-icon="inline-start" />
              {t('extensions.mcpApproval.review')}
            </Button>
          ) : null}
          {showConnect ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              {...busyProps}
              onClick={run(onConnect)}
            >
              <PlugZap data-icon="inline-start" />
              {t('extensions.connect')}
            </Button>
          ) : null}
          {showAuth ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              {...busyProps}
              onClick={run(onAuthStart)}
            >
              <KeyRound data-icon="inline-start" />
              {t('extensions.authenticate')}
            </Button>
          ) : null}
          {showWithdraw ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              {...busyProps}
              onClick={run(onWithdrawApproval)}
            >
              <ShieldOff data-icon="inline-start" />
              {t('extensions.mcpApproval.withdraw')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {issue ? (
        <p className="settings-inline-error" role="alert">
          <CircleAlert aria-hidden />
          <span>{issue}</span>
        </p>
      ) : null}
      {showReview ? (
        <p className="text-xs text-muted-foreground">
          {canReview ? t('extensions.mcpApproval.reviewNote') : t('extensions.mcpApproval.noHost')}
        </p>
      ) : null}
      {showAuth ? (
        <p className="text-xs text-muted-foreground">{t('extensions.mcpPage.authCodeNote')}</p>
      ) : null}
    </ExtensionDetailSection>
  );
}
