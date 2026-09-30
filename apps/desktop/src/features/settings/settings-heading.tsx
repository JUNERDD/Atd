import type { ReactNode } from 'react';
import { useSettingsSubpage } from './settings-navigation';

export function SettingsHeading({
  title,
  titleHint,
  description,
  children,
  subpage = false,
  backLabel,
}: {
  title: string;
  /** A note beside the title, such as a FieldHint whose text shows on hover or focus. */
  titleHint?: ReactNode;
  description?: string;
  children?: ReactNode;
  /**
   * Marks a sub-page: the window's content header adds the title to its breadcrumb and its Back
   * steps back through the section's page history, so the page itself carries no back button.
   */
  subpage?: boolean;
  /** Accessible name of the header's Back while this sub-page is shown. */
  backLabel?: string;
}) {
  useSettingsSubpage(subpage ? { title, backLabel } : null);
  return (
    <header
      className={`settings-page-heading ${children ? 'settings-overview-heading' : ''}`}
      /* On an overview the title only repeats the section name the breadcrumb shows. */
      data-section-title={subpage ? undefined : ''}
    >
      <div className="settings-section-heading">
        <div className="editor-heading">
          <h2 title={title}>{title}</h2>
          {titleHint}
        </div>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="settings-overview-toolbar">{children}</div>}
    </header>
  );
}
