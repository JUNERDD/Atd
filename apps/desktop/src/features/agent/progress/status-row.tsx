import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@atd/ui/components/item';
import { PopoverHeader, PopoverTitle } from '@atd/ui/components/popover';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { isComposingKey } from '@atd/ui/lib/ime';
import { createPointerGate } from '@atd/ui/lib/pointer-gate';
import { cn } from '@atd/ui/lib/utils';
import { STATUS_GLYPHS, type StatusGlyph } from './status-glyphs';

const ROW_SELECTOR = 'button.composer-status-row:not(:disabled)';

function blurRowToPopover(root: HTMLElement) {
  if (
    document.activeElement instanceof HTMLElement &&
    document.activeElement.matches('button.composer-status-row')
  ) {
    root.closest<HTMLElement>('[data-slot="popover-content"]')?.focus({ preventScroll: true });
  }
}

/**
 * A list view of the composer popover whose rows each open something with a state: the Subagents
 * and Side chats lists. A header names the list, the rows scroll under it, and `footer` trails
 * them inside the scroll area. The caller keeps the rows in the order they should read.
 */
export function StatusList({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: ReactNode;
  /** `StatusRow`s. */
  children: ReactNode;
}) {
  const [gate] = useState(() => createPointerGate(true));
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- delegates arrow-key navigation across focusable child row buttons.
    <div
      className="composer-status-list"
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          isComposingKey(event) ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey
        ) {
          return;
        }
        const { key } = event;
        if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return;
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(ROW_SELECTOR)];
        if (items.length === 0) return;
        event.preventDefault();
        gate.lock();
        const i =
          document.activeElement instanceof HTMLButtonElement
            ? items.indexOf(document.activeElement)
            : -1;
        let target: HTMLButtonElement | undefined;
        if (key === 'Home') target = items[0];
        else if (key === 'End') target = items.at(-1);
        else if (key === 'ArrowDown') target = i >= 0 ? items[(i + 1) % items.length] : items[0];
        else target = i >= 0 ? items[(i - 1 + items.length) % items.length] : items.at(-1);
        target?.focus({ preventScroll: true });
        target?.scrollIntoView?.({ block: 'nearest' });
      }}
      onPointerMove={(event) => {
        if (!gate.allowMove(event)) return;
        const row = (
          event.target instanceof Element ? event.target : null
        )?.closest<HTMLButtonElement>(ROW_SELECTOR);
        if (row) {
          if (document.activeElement !== row) row.focus({ preventScroll: true });
        } else {
          blurRowToPopover(event.currentTarget);
        }
      }}
      onPointerLeave={(event) => {
        if (gate.allowLeave(event)) blurRowToPopover(event.currentTarget);
      }}
    >
      <PopoverHeader className="composer-status-list-header">
        <PopoverTitle className="text-xs text-muted-foreground">{title}</PopoverTitle>
      </PopoverHeader>
      {/* The bar floats over the rows' trailing padding, as in menus and the panel: no lane, so the
          rows keep even insets and never narrow once the list scrolls. */}
      <ScrollArea className="composer-todos-scroll" gutter="none" scrollShadow>
        <ul className="composer-status-list-items" data-panel-focus>
          {children}
        </ul>
        {footer}
      </ScrollArea>
    </div>
  );
}

/**
 * One row of a `StatusList`, an `Item` row like the queue's: the state's glyph, the name, and
 * under it the state's short word with `context` (whose the item is, or what it ran on), then a
 * chevron to open it. The name takes up to `lines` lines: two for task texts that read alike until
 * late. The glyph is decorative, so the state leads the row's accessible name, which also carries
 * the full `actionLabel`; `title` is the whole name for the native tooltip. `current` marks the row
 * whose item is already on screen (`aria-current`, with a quiet fill). Without `onOpen` the row
 * opens nothing, so it is a plain entry at full strength rather than a dimmed disabled button. A
 * `badge` tags the item between its text and the chevron; the chevron keeps its place either way,
 * and the accessible name must say what the badge says.
 */
export function StatusRow({
  glyph,
  text,
  context = '',
  lines = 1,
  title,
  actionLabel,
  current = false,
  badge,
  onOpen,
}: {
  glyph: StatusGlyph;
  text: string;
  /** Follows the state under the name; empty shows the state alone. */
  context?: string;
  lines?: 1 | 2;
  title: string;
  /** What choosing the row does, in words ("Open <name>"). */
  actionLabel: string;
  current?: boolean;
  /** A `Badge` that tags the item, such as a temporary subagent. */
  badge?: ReactNode;
  onOpen: (() => void) | null;
}) {
  const { t } = useTranslation('tasks');
  const { Icon, className, label, word } = STATUS_GLYPHS[glyph];
  const body = (
    <>
      <ItemMedia variant="icon">
        <Icon strokeWidth={1.75} className={cn('size-4', className)} aria-hidden />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="composer-status-row-title" data-lines={lines} title={title}>
          {text}
        </ItemTitle>
        <ItemDescription className="text-xs">
          {context ? `${t(word)} · ${context}` : t(word)}
        </ItemDescription>
      </ItemContent>
      {badge}
    </>
  );
  if (!onOpen)
    return (
      <Item asChild size="xs" className="composer-status-row py-1 text-left">
        <li>{body}</li>
      </Item>
    );
  // Active rows share the hover/focus glass wash instead of drawing a separate focus ring.
  return (
    <li>
      <Item asChild size="xs" className="composer-status-row py-1 text-left">
        <button
          type="button"
          aria-label={`${t(label)} · ${actionLabel}`}
          aria-current={current ? 'true' : undefined}
          onClick={onOpen}
        >
          {body}
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </button>
      </Item>
    </li>
  );
}
