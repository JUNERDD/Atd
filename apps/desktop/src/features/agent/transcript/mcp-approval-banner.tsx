import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { McpApprovalDetails } from '@ai/agent-contracts';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@ai/ui/components/alert';
import { Button } from '@ai/ui/components/button';
import type { ViewBlock } from './adapter';
import { mcpNeedsApproval } from '../../service/use-mcp-state-label';
import { mcpApprovalsIn, useMcpApproval } from './use-mcp-approval';

/**
 * Asks the user to allow a server the agent configured, under the steps that configured it, so
 * the approval does not wait for a trip to Settings. Allow opens the host's native confirmation,
 * which shows what will run; the banner follows the server's current approval, so it settles
 * into a note once the server is allowed (here or in Settings) and disappears once it is removed.
 */
function McpApprovalBanner({ details }: { details: McpApprovalDetails }) {
  const { t } = useTranslation('tasks');
  const { approval, pending, issue, request } = useMcpApproval(details.serverId);
  const current = approval === undefined ? details.approval : approval;
  if (current === null) return null;
  const name = details.serverId;
  if (!mcpNeedsApproval(current))
    return (
      <Alert className="mcp-approval-banner">
        <ShieldCheck aria-hidden />
        <AlertTitle>{t('mcpApproval.allowedTitle', { name })}</AlertTitle>
        <AlertDescription>{t('mcpApproval.allowedDescription')}</AlertDescription>
      </Alert>
    );
  return (
    <Alert className="mcp-approval-banner">
      <ShieldAlert aria-hidden />
      <AlertTitle className="wrap-anywhere">
        {current === 'changed'
          ? t('mcpApproval.changedTitle', { name })
          : t('mcpApproval.requiredTitle', { name })}
      </AlertTitle>
      <AlertDescription>{t('mcpApproval.description')}</AlertDescription>
      {issue ? <AlertDescription className="text-destructive">{issue}</AlertDescription> : null}
      <AlertAction>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={pending || undefined}
          aria-busy={pending || undefined}
          className="aria-disabled:opacity-50"
          onClick={() => {
            if (!pending) void request();
          }}
        >
          {t('mcpApproval.allow')}
        </Button>
      </AlertAction>
    </Alert>
  );
}

/** Approval banners for the servers configured in one activity group. */
export function McpApprovalBanners({ steps }: { steps: readonly ViewBlock[] }) {
  const approvals = mcpApprovalsIn(steps);
  if (approvals.length === 0) return null;
  return (
    <>
      {approvals.map((details) => (
        <McpApprovalBanner key={details.serverId} details={details} />
      ))}
    </>
  );
}
