import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
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
 * The sub-page every skill, subagent and MCP server opens into, for adding one or for one item's
 * details, laid out like the command editor: a heading with Back, a scrolling body, and a footer
 * floating over it with the AI hand-off at its leading edge and the page's own actions trailing.
 * The page replaces the whole Extensions overview while it is open, so the list's search and tab
 * stay as they were when Back returns to it.
 */
export function ExtensionPage({
  label,
  title,
  badge,
  description,
  backLabel,
  onBack,
  ai,
  actions,
  children,
}: {
  /** Accessible name of the page region. */
  label: string;
  title: string;
  badge?: ExtensionPageBadge | null;
  description?: string;
  backLabel: string;
  onBack: () => void;
  /** Create or Edit with AI: hands the item to a new panel session seeded with its skill. */
  ai?: { label: string; disabled: boolean; onClick: () => void } | null;
  /** Trailing footer buttons, such as Cancel and Save. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const footerRef = useOverlayFooter<HTMLElement>();
  const hasFooter = Boolean(ai || actions);
  return (
    <section className="settings-editor extension-page" aria-label={label}>
      <SettingsHeading
        title={title}
        titleHint={badge ? <Badge variant={BADGE_VARIANT[badge.tone]}>{badge.label}</Badge> : null}
        description={description}
        onBack={onBack}
        backLabel={backLabel}
      />
      <ScrollArea
        className="flex-1 min-h-0 min-w-0 m-[-3px_-15px_-3px_-3px]"
        viewportClassName={hasFooter ? 'overlay-footer-fade' : undefined}
        gutter="stable"
      >
        <div className="settings-editor-inner extension-page-body">{children}</div>
      </ScrollArea>
      {hasFooter ? (
        <footer ref={footerRef} className="editor-footer overlay-footer">
          {ai ? (
            <Button type="button" variant="outline" disabled={ai.disabled} onClick={ai.onClick}>
              <Sparkles data-icon="inline-start" />
              {ai.label}
            </Button>
          ) : null}
          {actions ? <div>{actions}</div> : null}
        </footer>
      ) : null}
    </section>
  );
}
