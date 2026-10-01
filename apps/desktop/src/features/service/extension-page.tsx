import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@ai/ui/components/badge';
import { Button } from '@ai/ui/components/button';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { useOverlayFooter } from '../../components/use-overlay-footer';
import { SettingsHeading } from '../settings/settings-heading';

/** The item's state next to its name: on, off, or failing. */
export interface ExtensionPageBadge {
  label: string;
  tone: 'on' | 'off' | 'error';
}

const BADGE_VARIANT = { on: 'secondary', off: 'outline', error: 'destructive' } as const;

/**
 * Whether the heading's description is cut off by its line clamp (settings.css), measured again
 * whenever the page resizes or the text changes, so Show more appears only when there is more.
 */
function useDescriptionClamped(page: RefObject<HTMLElement | null>, text: string | undefined) {
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const paragraph = page.current?.querySelector<HTMLElement>('.settings-section-heading > p');
    if (!paragraph) return;
    // The observer reports the paragraph's size once on observing it, then on every change.
    const observer = new ResizeObserver(() =>
      setClamped(paragraph.scrollHeight > paragraph.clientHeight + 1),
    );
    observer.observe(paragraph);
    return () => observer.disconnect();
  }, [page, text]);
  return clamped && Boolean(text);
}

/**
 * The sub-page every plugin, skill, subagent and MCP server opens into, for adding or installing
 * one or for one item's details, laid out like the command editor: a heading with Back, a scrolling body, and a footer
 * floating over it with the AI hand-off at its leading edge and the page's own actions trailing.
 * The page replaces the whole Extensions overview while it is open, so the list's search and tab
 * stay as they were when Back returns to it. A long description stays clamped under the title so
 * the body keeps its room in a short window; Show more below it unclamps it in place.
 */
export function ExtensionPage({
  label,
  title,
  badge,
  titleExtra,
  description,
  backLabel,
  ai,
  note,
  actions,
  children,
}: {
  /** Accessible name of the page region. */
  label: string;
  title: string;
  badge?: ExtensionPageBadge | null;
  /** Controls after the title, such as a plugin's version and its switch. */
  titleExtra?: ReactNode;
  description?: string;
  /** Accessible name of the header's Back while the page is shown. */
  backLabel: string;
  /** Create or Edit with AI: hands the item to a new panel session seeded with its skill. */
  ai?: { label: string; disabled: boolean; onClick: () => void } | null;
  /** A short note at the footer's leading edge, where the AI hand-off would sit. */
  note?: string;
  /** Trailing footer buttons, such as Cancel and Save. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation('settings');
  const footerRef = useOverlayFooter<HTMLElement>();
  const pageRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const clamped = useDescriptionClamped(pageRef, description);
  const hasFooter = Boolean(ai || note || actions);
  return (
    <section
      ref={pageRef}
      className="settings-editor extension-page"
      aria-label={label}
      data-description={expanded ? 'full' : undefined}
    >
      <SettingsHeading
        title={title}
        titleHint={
          badge || titleExtra ? (
            <>
              {badge ? <Badge variant={BADGE_VARIANT[badge.tone]}>{badge.label}</Badge> : null}
              {titleExtra}
            </>
          ) : null
        }
        description={description}
        subpage
        backLabel={backLabel}
      />
      {clamped || expanded ? (
        <Button
          type="button"
          variant="link"
          size="xs"
          className="extension-page-more"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? t('extensions.descriptionLess') : t('extensions.descriptionMore')}
        </Button>
      ) : null}
      <ScrollArea
        className="flex-1 min-h-0 min-w-0 m-[-3px_-15px_-3px_-3px]"
        viewportClassName={hasFooter ? 'overlay-footer-fade' : undefined}
        gutter="stable"
        scrollShadow
      >
        <div className="settings-editor-inner extension-page-body">{children}</div>
      </ScrollArea>
      {hasFooter ? (
        <footer ref={footerRef} className="editor-footer overlay-footer">
          {ai ? (
            <Button type="button" variant="glass" disabled={ai.disabled} onClick={ai.onClick}>
              <Sparkles data-icon="inline-start" />
              {ai.label}
            </Button>
          ) : note ? (
            <p className="settings-field-note">{note}</p>
          ) : null}
          {actions ? <div>{actions}</div> : null}
        </footer>
      ) : null}
    </section>
  );
}
