import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/icon-button';

export function SettingsHeading({
  title,
  titleHint,
  description,
  children,
  onBack,
  backLabel,
}: {
  title: string;
  /** A note beside the title, such as a FieldHint whose text shows on hover or focus. */
  titleHint?: ReactNode;
  description?: string;
  children?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
}) {
  const { t } = useTranslation('settings');
  return (
    <header
      className={`settings-page-heading ${children ? 'settings-overview-heading' : ''}`}
      /* A back button marks a sub-page; without one the title only repeats the section name. */
      data-section-title={onBack ? undefined : ''}
    >
      <div className="settings-section-heading">
        <div className="editor-heading">
          {onBack && (
            <IconButton
              label={t('heading.back')}
              aria-label={backLabel ?? t('heading.back')}
              onClick={onBack}
            >
              <ArrowLeft />
            </IconButton>
          )}
          <h2 title={title}>{title}</h2>
          {titleHint}
        </div>
        {description && <p title={description}>{description}</p>}
      </div>
      {children && <div className="settings-overview-toolbar">{children}</div>}
    </header>
  );
}
