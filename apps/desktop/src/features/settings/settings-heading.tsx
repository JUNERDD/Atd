import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from '../../components/icon-button';

export function SettingsHeading({
  title,
  description,
  children,
  onBack,
  backLabel,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <header className={`settings-page-heading ${children ? 'settings-overview-heading' : ''}`}>
      <div className="settings-section-heading">
        <div className="editor-heading">
          {onBack && (
            <IconButton label="Back" aria-label={backLabel ?? 'Back'} onClick={onBack}>
              <ArrowLeft />
            </IconButton>
          )}
          <h2 title={title}>{title}</h2>
        </div>
        {description && <p title={description}>{description}</p>}
      </div>
      {children && <div className="settings-overview-toolbar">{children}</div>}
    </header>
  );
}
