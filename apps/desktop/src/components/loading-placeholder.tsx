import type { ReactNode } from 'react';
import { Item, ItemContent, ItemGroup, ItemMedia } from '@atd/ui/components/item';
import { Skeleton } from '@atd/ui/components/skeleton';
import { cn } from '@atd/ui/lib/utils';
import './loading-placeholder.css';

/**
 * The region a page, list or detail view shows before its first content arrives: `Skeleton`
 * shapes laid out like that content, so the view keeps its structure instead of going blank or
 * swapping a line of text for a different layout. Assistive technology hears `label`, which names
 * what is loading ("Loading commands…"); the shapes are hidden from it. The region fades in after a
 * short delay, so a load that finishes at once shows nothing.
 *
 * Shapes follow the anatomy of the content they stand in for: rows (`ItemsPlaceholder`), cards
 * (`ListCardGridPlaceholder` in `list-card.tsx`), form fields (`FieldsPlaceholder`), or a feature's
 * own composition of `Skeleton` and `TextPlaceholder` inside the same containers its content uses.
 */
export function LoadingPlaceholder({
  label,
  className,
  children,
}: {
  label: string;
  className?: string | undefined;
  /** The shapes; a region with none (a window's first frame) only names the task. */
  children?: ReactNode;
}) {
  return (
    <output className={cn('loading-placeholder', className)} aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="loading-placeholder-shapes" aria-hidden>
        {children}
      </div>
    </output>
  );
}

/** Line lengths as fractions of the line's container (`data-width` in the CSS). */
const LINE_WIDTHS = [
  'quarter',
  'third',
  'twoFifths',
  'half',
  'threeFifths',
  'twoThirds',
  'threeQuarters',
  'fourFifths',
  'full',
] as const;

export type LineWidth = (typeof LINE_WIDTHS)[number];

/** Lengths that vary from row to row, so a column of placeholders reads as text, not stripes. */
const TITLE_WIDTHS: readonly LineWidth[] = ['twoFifths', 'third', 'half', 'quarter'];
const DESCRIPTION_WIDTHS: readonly LineWidth[] = [
  'threeQuarters',
  'twoThirds',
  'fourFifths',
  'threeFifths',
];

/** The length of row `index`'s line in a column whose lines vary as `widths` does. */
function lineWidth(widths: readonly LineWidth[], index: number): LineWidth {
  return widths[index % widths.length] ?? 'half';
}

/**
 * One line of text: a rounded bar centered in the line box of the text it stands in for, so a
 * swap to real text keeps the height. `sm` matches 14/20 text, `xs` 12/16, `heading` a page
 * title's 24/32.
 */
export function TextPlaceholder({
  size = 'sm',
  width = 'half',
}: {
  size?: 'sm' | 'xs' | 'heading';
  width?: LineWidth;
}) {
  return (
    <span
      className={cn(
        'flex items-center',
        size === 'heading' ? 'h-8' : size === 'sm' ? 'h-5' : 'h-4',
      )}
    >
      <Skeleton
        data-width={width}
        className={cn(
          'line-placeholder rounded-full',
          size === 'heading' ? 'h-5' : size === 'sm' ? 'h-3' : 'h-2.5',
        )}
      />
    </span>
  );
}

/**
 * Rows of an `ItemGroup` list (commands, automations, runs, app permissions): an icon, a title over
 * a description, and an optional trailing switch, at the same `Item` size and padding as the rows.
 * `variant` matches the rows' own `Item` variant (outlined rows stand alone in a list); `inCard`
 * gives the rows the `settings-card-row` geometry of lists inside a settings card.
 */
export function ItemsPlaceholder({
  count = 3,
  size = 'default',
  variant = 'default',
  description = true,
  trailing = 'switch',
  inCard = false,
}: {
  count?: number;
  size?: 'default' | 'sm';
  variant?: 'default' | 'outline';
  description?: boolean;
  trailing?: 'switch' | 'none';
  inCard?: boolean;
}) {
  return (
    <ItemGroup>
      {Array.from({ length: count }, (_, index) => (
        <Item
          key={index}
          size={size}
          variant={variant}
          className={inCard ? 'settings-card-row' : undefined}
        >
          <ItemMedia variant="icon">
            <Skeleton className="size-4 rounded-md" />
          </ItemMedia>
          <ItemContent>
            <TextPlaceholder width={lineWidth(TITLE_WIDTHS, index)} />
            {description && <TextPlaceholder width={lineWidth(DESCRIPTION_WIDTHS, index)} />}
          </ItemContent>
          {trailing === 'switch' && <Skeleton className="h-5 w-8 shrink-0 rounded-full" />}
        </Item>
      ))}
    </ItemGroup>
  );
}

/**
 * Labeled fields of an editor or detail form: a label line over a control at the shared 32px
 * control height, with the label-to-control and field-to-field rhythm of the editor forms.
 */
export function FieldsPlaceholder({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-5">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <TextPlaceholder width={lineWidth(TITLE_WIDTHS, index)} />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}
