import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertAction, AlertDescription } from '@atd/ui/components/alert';
import { Button } from '@atd/ui/components/button';

/**
 * The one-time notice that launch approvals arrived: servers configured before them stay off until
 * the user reviews and allows each one. Dismissing it is saved by the service, for every client.
 */
export function McpApprovalNotice({
  disabled,
  onDismiss,
}: {
  disabled: boolean;
  onDismiss: () => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <Alert>
      <ShieldAlert />
      <AlertDescription>{t('extensions.mcpApproval.notice')}</AlertDescription>
      <AlertAction>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onDismiss}>
          {t('extensions.mcpApproval.noticeDismiss')}
        </Button>
      </AlertAction>
    </Alert>
  );
}
