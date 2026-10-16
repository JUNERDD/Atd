import type { ReactNode } from 'react';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { useSettingsSubpage } from './settings-navigation';

export function SettingsHeading({
  title,
  titleHint,
  description,
  children,
  subpage = false,
  backLabel,
  scrollDescription = false,
}: {
  title: string;
  /** A note beside the title, such as a FieldHint whose text shows on hover or focus. */
  titleHint?: ReactNode;
  description?: string | undefined;
  children?: ReactNode;
  /**
   * Marks a sub-page: the window's content header adds the title to its breadcrumb and its Back
   * steps back through the section's page history, so the page itself carries no back button.
   */
  subpage?: boolean;
  /** Accessible name of the header's Back while this sub-page is shown. */
  backLabel?: string | undefined;
  /**
   * Holds the description in a ScrollArea, for a page that caps a long one (the extension page's
   * Show more) so it scrolls with the shared bar instead of WebKit's own.
   */
  scrollDescription?: boolean;
}) {
  useSettingsSubpage(subpage ? { title, ...(backLabel === undefined ? {} : { backLabel }) } : null);
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
        {description &&
          (scrollDescription ? (
            <ScrollArea
              className="settings-heading-description"
              viewportClassName="max-h-[inherit]"
            >
              <p>{description}</p>
            </ScrollArea>
          ) : (
            <p>{description}</p>
          ))}
      </div>
      {children && <div className="settings-overview-toolbar">{children}</div>}
    </header>
  );
}
