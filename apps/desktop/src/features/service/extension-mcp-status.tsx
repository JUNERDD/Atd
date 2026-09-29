import { KeyRound, PlugZap, ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
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
 * row is absent until the status list has it.
 */
export function McpStatusSection({
  row,
  locked,
  onConnect,
  onAuthStart,
  onRequestApproval,
  onWithdrawApproval,
}: {
  row: ExtensionMcpRow | undefined;
  locked: boolean;
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
              disabled={locked || !canReview}
              onClick={onRequestApproval}
            >
              <ShieldCheck data-icon="inline-start" />
              {t('extensions.mcpApproval.review')}
            </Button>
          ) : null}
          {showConnect ? (
            <Button type="button" variant="outline" size="sm" disabled={locked} onClick={onConnect}>
              <PlugZap data-icon="inline-start" />
              {t('extensions.connect')}
            </Button>
          ) : null}
          {showAuth ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={locked}
              onClick={onAuthStart}
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
              disabled={locked}
              onClick={onWithdrawApproval}
            >
              <ShieldOff data-icon="inline-start" />
              {t('extensions.mcpApproval.withdraw')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {showReview ? (
        <p className="text-muted-foreground text-xs">
          {canReview ? t('extensions.mcpApproval.reviewNote') : t('extensions.mcpApproval.noHost')}
        </p>
      ) : null}
      {showAuth ? (
        <p className="text-muted-foreground text-xs">{t('extensions.mcpPage.authCodeNote')}</p>
      ) : null}
    </ExtensionDetailSection>
  );
}
