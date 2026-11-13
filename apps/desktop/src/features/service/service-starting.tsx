import { useTranslation } from 'react-i18next';
import { WindowLoading } from '../../components/window-loading';

/**
 * Fills the whole panel, header included, while the service starts. The surface drags the window
 * like the header it replaces; macOS paints its traffic lights over it.
 */
export function ServiceStarting() {
  const { t } = useTranslation('panel');
  return (
    <div className="service-starting">
      <WindowLoading
        className="service-starting-content"
        title={t('service.starting.title')}
        description={t('service.starting.description')}
      />
    </div>
  );
}
