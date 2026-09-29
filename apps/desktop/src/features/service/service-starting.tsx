import { useTranslation } from 'react-i18next';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@ai/ui/components/empty';
import { Spinner } from '@ai/ui/components/spinner';

/**
 * Fills the whole panel, header included, while the service starts. The surface drags the window
 * like the header it replaces; macOS paints its traffic lights over it.
 */
export function ServiceStarting() {
  const { t } = useTranslation('panel');
  return (
    <div className="service-starting">
      <Empty className="service-starting-content">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner />
          </EmptyMedia>
          <EmptyTitle>{t('service.starting.title')}</EmptyTitle>
          <EmptyDescription>{t('service.starting.description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
