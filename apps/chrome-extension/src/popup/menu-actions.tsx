import { useTranslation } from 'react-i18next';
import type { PopupMessage } from '../messages/popup.ts';

/**
 * The last items of the popup, read like a menu bar extra's: plain rows without icons. Both travel
 * to the Atd shell, so they are unavailable while it cannot be reached; choosing one closes the
 * popup, as choosing a menu item does.
 */
export function MenuActions({
  enabled,
  onChoose,
}: {
  enabled: boolean;
  onChoose: (message: PopupMessage) => void;
}) {
  const { t } = useTranslation('popup');
  return (
    <nav className="pp-actions">
      <button type="button" disabled={!enabled} onClick={() => onChoose({ type: 'app.open' })}>
        {t('actions.openApp')}
      </button>
      <button type="button" disabled={!enabled} onClick={() => onChoose({ type: 'settings.open' })}>
        {t('actions.settings')}
      </button>
    </nav>
  );
}
