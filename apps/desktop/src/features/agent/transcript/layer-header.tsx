import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@atd/ui/components/popover';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { IconButton } from '../../../components/icon-button';

/** The view's name, whole in its native tooltip once it truncates, and its mark. */
function TitleText({ title, mark }: { title: string; mark: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate" title={title}>
        {title}
      </span>
      {mark}
    </span>
  );
}

/**
 * The view's details behind its title, after the macOS document title: the title (with its mark
 * and a chevron) is the trigger, and the popover repeats it in full above `details`. The details
 * scroll as one body under that heading, so a long text never stacks a second scroller in the
 * header. Its trigger sits exactly where the plain title would (`-ml-3` cancels the ghost button's
 * padding), so the hover fill reaches into the gap after the separator instead of moving the text.
 * The body takes focus on open, so the keyboard scrolls it; its ring draws inside the scroll area.
 */
function TitleDetails({
  title,
  mark,
  details,
}: {
  title: string;
  mark: ReactNode;
  details: ReactNode;
}) {
  const titleId = useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-3 min-w-0 shrink">
          <TitleText title={title} mark={mark} />
          <ChevronDown data-icon="inline-end" className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      {/* The body scrolls while open, so it renders beside the glass rather than in it. */}
      <PopoverContent
        side="bottom"
        align="start"
        material="backdrop"
        aria-labelledby={titleId}
        className="child-header-details"
      >
        {/* A name too long for one line takes its own lines, and the mark starts the next one
            flush with it rather than indented by the gap. */}
        <PopoverTitle id={titleId} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="min-w-0 wrap-anywhere">{title}</span>
          {mark}
        </PopoverTitle>
        {/* Reaches 12px into the popover's padding on both sides, where its bar floats and its
            focus ring draws 4px off the edges, and 4px above and below the text, so the ring
            clears it; the content pads all of it back, keeping the text where it would be. */}
        <ScrollArea
          scrollShadow
          gutter="none"
          className="-mx-3 -my-1 rounded-xl has-focus-visible:ring-3 has-focus-visible:inset-ring has-focus-visible:ring-ring/30 has-focus-visible:inset-ring-ring has-focus-visible:ring-inset"
          viewportProps={{ tabIndex: 0 }}
        >
          <div className="px-3 py-1">{details}</div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The header of a view laid over a conversation (a subagent's drill-in, a side chat): one row with
 * the way back, where the view sits as "parent › view", and `actions` (a More menu) at its end.
 * `mark` qualifies the view's name (a task agent's Temporary badge); `details` say what the view
 * is and open from its name, so the row is all the height the header takes. The view carries no
 * task, status or error of its own here. The back action takes focus on open so keyboard users
 * land inside the new view, unless `takeFocus` is off for a view that focuses its own first field.
 */
export function LayerHeader({
  parentTitle,
  title,
  backLabel,
  breadcrumbLabel,
  onBack,
  takeFocus = true,
  mark,
  details,
  actions,
}: {
  parentTitle: string;
  title: string;
  backLabel: string;
  /** Names the breadcrumb navigation for assistive technology. */
  breadcrumbLabel: string;
  onBack: () => void;
  takeFocus?: boolean;
  mark?: ReactNode;
  details?: ReactNode;
  actions?: ReactNode;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  // Only as the view opens: a later `takeFocus` change must not pull focus back here.
  const focusOnOpen = useRef(takeFocus);
  useEffect(() => {
    if (focusOnOpen.current) backRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <header className="child-header">
      <IconButton ref={backRef} label={backLabel} className="-ml-1.5" onClick={onBack}>
        <ArrowLeft />
      </IconButton>
      <nav aria-label={breadcrumbLabel} className="min-w-0 flex-1">
        <ol className="child-header-crumbs m-0 flex min-w-0 list-none items-center gap-1 p-0 text-sm">
          <li className="min-w-0 truncate text-muted-foreground" title={parentTitle}>
            {parentTitle}
          </li>
          {/* 17px from the text on either side: room for the title trigger's padding and focus
              ring, which reach back toward it, to clear the glyph. */}
          <li aria-hidden="true" className="mx-2 flex shrink-0 text-muted-foreground">
            <ChevronRight className="size-3.5" />
          </li>
          <li aria-current="page" className="flex min-w-0 font-medium">
            {details ? (
              <TitleDetails title={title} mark={mark} details={details} />
            ) : (
              <TitleText title={title} mark={mark} />
            )}
          </li>
        </ol>
      </nav>
      {actions}
    </header>
  );
}
