import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@ai/ui/components/empty';
import { Spinner } from '@ai/ui/components/spinner';
import { IconButton } from '../../components/icon-button';

/**
 * Fills the whole panel, header included, while the service starts. The surface drags the window
 * like the header it replaces; macOS paints its traffic lights over it, and `onHide` keeps the
 * header's hide action where a frameless panel has no native controls.
 */
export function ServiceStarting({ onHide }: { onHide?: () => void }) {
  const { t } = useTranslation('panel');
  return (
    <div className="service-starting">
      {onHide && (
        <IconButton
          label={t('header.hide')}
          className="header-button service-starting-hide"
          onClick={onHide}
        >
          <X />
        </IconButton>
      )}
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
