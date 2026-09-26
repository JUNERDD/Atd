import type { ReactNode } from 'react';
import { Badge } from '@ai/ui/components/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ai/ui/components/dialog';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { StreamdownMarkdown } from '../agent/transcript/markdown';

export interface DetailField {
  label: string;
  value: ReactNode;
  /** Paths, revisions and commands: monospaced, and free to break anywhere. */
  mono?: boolean;
}

/** The item's state next to its name: on, off, or failing. */
export interface DetailBadge {
  label: string;
  tone: 'on' | 'off' | 'error';
}

const BADGE_VARIANT = { on: 'secondary', off: 'outline', error: 'destructive' } as const;

/**
 * Read-only details for one skill, subagent or MCP server. The header stays put while the fields
 * and the long text (a system prompt, a skill's files) scroll below it, so long content fits short
 * windows. `status` replaces the body while it loads or failed to load. `wide` suits content that
 * reads like a document; a few fields keep the narrow dialog.
 */
export function ExtensionDetailDialog({
  open,
  onOpenChange,
  title,
  description,
  badge,
  fields,
  text,
  status,
  wide = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  badge: DetailBadge;
  fields: DetailField[];
  /** Markdown shown in full below the fields, such as a subagent's system prompt. */
  text?: { label: string; value: string } | null;
  status?: { text: string; error: boolean } | null;
  wide?: boolean;
  /** Content after the fields, such as a skill's folder. */
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="panel-dialog extension-detail-dialog" data-wide={wide}>
        <DialogHeader className="extension-detail-header">
          <div className="extension-detail-heading">
            <DialogTitle className="extension-detail-title">{title}</DialogTitle>
            <Badge variant={BADGE_VARIANT[badge.tone]}>{badge.label}</Badge>
          </div>
          {/* The shared description truncates to one line; here it is the item's full description. */}
          <DialogDescription className="extension-detail-description">
            {description}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="extension-detail-scroll">
          {status ? (
            <output className="extension-detail-status" data-error={status.error}>
              {status.text}
            </output>
          ) : (
            <div className="extension-detail-body">
              {fields.length ? (
                <dl className="extension-detail-fields">
                  {fields.map((field) => (
                    <div key={field.label}>
                      <dt>{field.label}</dt>
                      <dd className={field.mono ? 'font-mono' : undefined} data-mono={field.mono}>
                        {field.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {text ? (
                <section className="extension-detail-section" aria-label={text.label}>
                  <h3>{text.label}</h3>
                  <div className="extension-detail-text">
                    <StreamdownMarkdown text={text.value} streaming={false} />
                  </div>
                </section>
              ) : null}
              {children}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
