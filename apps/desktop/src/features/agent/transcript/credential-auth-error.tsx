import { credentialAuthError } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { useTranslation } from 'react-i18next';
import { showErrorToast } from '../../../components/toast-store';

/**
 * Renders a localized explanation and shortcut to Settings → Providers when a task failed
 * because saved credentials became unreadable (e.g. OS keychain ACL mismatch after an update)
 * or could not be found.
 */
export function CredentialAuthError({ error }: { error: string }) {
  const { t } = useTranslation('tasks');
  const code = credentialAuthError(error);
  if (!code) return null;
  return (
    <div className="flex flex-col items-start gap-2">
      <p>
        {t(
          code === 'credential_unreadable' ? 'credentialAuth.unreadable' : 'credentialAuth.missing',
        )}
      </p>
      <Button
        size="xs"
        variant="outline"
        onClick={() => void window.desktop?.settings.openSection('providers').catch(showErrorToast)}
      >
        {t('credentialAuth.openSettings')}
      </Button>
      <details className="text-xs">
        <summary className="cursor-pointer">{t('credentialAuth.details')}</summary>
        <p className="mt-2 wrap-anywhere whitespace-pre-wrap">{error}</p>
      </details>
    </div>
  );
}
