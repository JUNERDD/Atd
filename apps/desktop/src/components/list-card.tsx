import type { ComponentProps, ReactNode } from 'react';
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@atd/ui/components/card';
import { cn } from '@atd/ui/lib/utils';
import './list-card.css';
import './open-row.css';

/**
 * The cards of an overview, as many columns of at least 240px as its width holds; a list whose
 * cards need more room sets `--list-card-min` through `className`.
 */
export function ListCardGrid({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  return <ul className={cn('list-card-grid', className)}>{children}</ul>;
}

/** Pointer handlers a list adds to the button that opens a whole card, such as a drag out. */
export type ListCardOpenGesture = Pick<
  ComponentProps<'button'>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onClickCapture'
>;

/**
 * One item of an overview as a card (`ListCardGrid`): Settings › Extensions lists plugins with it
 * and both app lists list apps (Figma `App / Plugin card · Rhea`, `App / App list card · Rhea`).
 * The header holds the 36px media and the name, with an optional line under it, and the actions
 * centered on the media; then the description, clamped to two lines with room for two, so cards
 * keep one height; and at the foot the meta line, which truncates before the badges after it. With
 * `open` the whole card opens a page: its button fills the card beneath the content and paints
 * hover and focus (open-row.css), and takes the list's `gesture` handlers.
 */
export function ListCard({
  media,
  name,
  nameText,
  detail,
  actions,
  description,
  descriptionText,
  meta,
  badges,
  open,
  busy,
}: {
  media: ReactNode;
  /** The name as shown, which may mark a search match. */
  name: ReactNode;
  /** The name as plain text, for the tooltip of a truncated name. */
  nameText: string;
  /** A line under the name, such as an installed plugin's source and version. */
  detail?: string | undefined;
  /** Controls at the end of the header. */
  actions?: ReactNode;
  /** The description as shown, or what stands in for a missing one. */
  description: ReactNode;
  /** The description as plain text, for its tooltip. */
  descriptionText?: string | undefined;
  /** What the item holds or when it last changed. */
  meta: string;
  /** States after the meta line. */
  badges?: ReactNode;
  /** The page the whole card opens: its button's accessible name and handler. */
  open?:
    | { label: string; onOpen: () => void; gesture?: ListCardOpenGesture | undefined }
    | undefined;
  /** A write for this item is running. */
  busy?: boolean | undefined;
}) {
  return (
    <li className="list-card-cell" aria-busy={busy || undefined}>
      <Card
        size="sm"
        className={open ? 'list-card open-row dark:bg-input/40' : 'list-card dark:bg-input/40'}
      >
        {open && (
          <button
            {...open.gesture}
            type="button"
            className="open-row-button"
            aria-label={open.label}
            onClick={open.onOpen}
          />
        )}
        <CardHeader>
          <div className="flex min-w-0 items-center gap-3">
            {media}
            <div className="min-w-0">
              <CardTitle className="truncate text-sm" title={nameText}>
                {name}
              </CardTitle>
              {detail ? (
                <p className="truncate text-xs text-muted-foreground" title={detail}>
                  {detail}
                </p>
              ) : null}
            </div>
          </div>
          {actions ? <CardAction>{actions}</CardAction> : null}
        </CardHeader>
        <CardContent>
          <p className="list-card-description text-muted-foreground" title={descriptionText}>
            {description}
          </p>
        </CardContent>
        <CardFooter className="list-card-footer">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={meta}>
            {meta}
          </span>
          {badges}
        </CardFooter>
      </Card>
    </li>
  );
}
