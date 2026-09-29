import type { ReactNode } from 'react';
import { useSettingsSubpage } from './settings-navigation';

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
  /**
   * Marks a sub-page: the window's content header shows Back (running this) and adds the title to
   * its breadcrumb, so the page itself carries no back button.
   */
  onBack?: () => void;
  /** Accessible name of the header's Back while this sub-page is shown. */
  backLabel?: string;
}) {
  useSettingsSubpage(onBack ? { title, backLabel, onBack } : null);
  return (
    <header
      className={`settings-page-heading ${children ? 'settings-overview-heading' : ''}`}
      /* Without a back action the title only repeats the section name the breadcrumb shows. */
      data-section-title={onBack ? undefined : ''}
    >
      <div className="settings-section-heading">
        <div className="editor-heading">
          <h2 title={title}>{title}</h2>
          {titleHint}
        </div>
        {description && <p title={description}>{description}</p>}
      </div>
      {children && <div className="settings-overview-toolbar">{children}</div>}
    </header>
  );
}
