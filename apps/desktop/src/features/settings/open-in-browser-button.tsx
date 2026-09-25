import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { IconButton } from '../../components/icon-button';
import { showErrorToast } from '../../components/toast-store';

/**
 * Opens the web client of the connected service in the default browser, signed in through a
 * one-time link. Desktop only: the web client is that page already.
 */
export function OpenInBrowserButton() {
  const { t } = useTranslation('settings');
  const [opening, setOpening] = useState(false);
  const service = window.desktop?.service;
  if (window.desktop?.runtime !== 'electron' || !service) return null;
  return (
    <IconButton
      label={t('openInBrowser')}
      disabled={opening}
      onClick={() => {
        setOpening(true);
        void service
          .openInBrowser()
          .catch(showErrorToast)
          .finally(() => setOpening(false));
      }}
    >
      <Globe />
    </IconButton>
  );
}
