import {
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type Ref,
} from 'react';
import { MotionConfig, motion, type Transition } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { HighlightedText } from '@atd/ui/components/highlighted-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';
import { cn } from '@atd/ui/lib/utils';
import { IconButton } from '../../components/icon-button';
import { useSectionPin, type QuickSection, type SectionScroller } from './use-section-pin';

/** The highlight sliding to another section: a selection move, so no bounce. */
const SLIDE: Transition = { type: 'spring', visualDuration: 0.2, bounce: 0 };
/** The section bar's width on the list's host, which every heading ends before (quick-panel.css). */
const BAR_WIDTH = '--quick-panel-bar-width';

/**
 * The quick panel's list with its pinned row over the top edge. The row's labels are an
 * `aria-hidden` overlay (use-section-pin.ts places them; cmdk's inline headings keep naming the
 * groups). While the list is scrolled, the row takes the pointer, so the rows faded out under it
 * can be neither hovered nor clicked, and passes its wheel on to the list. With two or more
 * sections the row's trailing end holds the section bar, which the push never moves: one ghost icon
 * button per section, in list order, and a highlight that slides between them (shared layout) with
 * a pressed ghost button's fill. Each button keeps the 28px target but draws its highlight and
 * hover as 22px circles, which the row's height keeps clear of the rows below. The highlight
 * follows a running jump's target; at the end of the list (or when nothing scrolls) the active
 * option's section; otherwise the pinned one. Past three quarters of the row the bar scrolls
 * sideways, fading at a clipped edge and keeping the highlight in view. Focus never leaves the
 * editor: the buttons are out of the tab order and the popover cancels their mousedown; a click
 * (release) jumps.
 */
export function QuickPanelSections({
  ref,
  list,
  open,
  sections,
  active,
  onPick,
  onDismiss,
  children,
}: {
  /** Jump scrolling for the selection model. */
  ref: Ref<SectionScroller>;
  list: HTMLElement | null;
  open: boolean;
  sections: readonly QuickSection[];
  /** The active option's section; null when it is in none. */
  active: number | null;
  /** A section button's click: the same as a jump to that section. */
  onPick: (index: number) => void;
  /** The panel's Esc. A button's tooltip is a dismissable layer above the popover's and so takes
   * Esc first; it closes the panel the same way rather than only itself. */
  onDismiss: () => void;
  /** The `CommandList` the row lies over. */
  children: ReactNode;
}) {
  const { t } = useTranslation('panel');
  const host = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  // A fresh id per opening, so the highlight never slides in from a previous opening's bar.
  const capsule = useId();
  const { scrolled, pinned, atBottom, target, overlay, scrollTo, scrollBy, stop } = useSectionPin({
    list,
    sections,
    open,
  });
  useImperativeHandle(ref, () => ({ scrollTo, stop }), [scrollTo, stop]);
  const showBar = sections.length >= 2;
  const highlight = target ?? (atBottom && active !== null ? active : pinned);

  /** Marks the clipped ends of an overflowing bar, which quick-panel.css fades. */
  const markEdges = () => {
    const strip = bar.current;
    if (!strip) return;
    strip.toggleAttribute('data-clip-start', strip.scrollLeft > 1);
    strip.toggleAttribute(
      'data-clip-end',
      strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 1,
    );
  };

  // Every heading, inline or pinned, ends before the bar: a long name never runs under it, and the
  // pinned label truncates exactly where the inline heading it replaces did. The bar's width
  // follows the row's (it is capped to three quarters of it), so it is measured on every resize.
  useLayoutEffect(() => {
    const node = host.current;
    const strip = bar.current;
    if (!node) return;
    if (!strip) {
      node.style.removeProperty(BAR_WIDTH);
      return;
    }
    const measure = () => {
      node.style.setProperty(BAR_WIDTH, `${strip.offsetWidth}px`);
      markEdges();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [showBar, sections.length]);

  // An overflowing bar scrolls its highlight into view. Not `scrollIntoView`, which would scroll
  // the list too.
  useLayoutEffect(() => {
    const strip = bar.current;
    const item = strip?.querySelector<HTMLElement>('[data-current]');
    if (!strip || !item || strip.scrollWidth <= strip.clientWidth) return;
    const start = item.offsetLeft;
    const end = start + item.offsetWidth;
    if (start < strip.scrollLeft) strip.scrollLeft = start;
    else if (end > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = end - strip.clientWidth;
  }, [highlight]);

  return (
    <div ref={host} className="relative flex min-h-0 flex-1 flex-col">
      {children}
      {sections.length > 0 && (
        // Twice the row's height: a heading rising into the slot shows whole below it.
        <div
          ref={overlay}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-14 max-h-full overflow-hidden"
        >
          {scrolled &&
            sections.map((section) => (
              <div
                key={section.id}
                className="quick-panel-pinned-label invisible absolute inset-x-0 top-0 px-2 py-1.5 text-xs font-medium text-muted-foreground"
              >
                <HighlightedText text={section.heading} ranges={section.headingRanges} />
              </div>
            ))}
        </div>
      )}
      {sections.length > 0 && (
        <div
          aria-hidden
          className={cn(
            'absolute inset-x-0 top-0 h-7',
            scrolled ? 'pointer-events-auto' : 'pointer-events-none',
          )}
          onWheel={(event) => scrollBy(event.deltaY)}
        />
      )}
      {showBar && (
        <MotionConfig reducedMotion="user">
          <motion.div
            ref={bar}
            layoutScroll
            role="toolbar"
            aria-label={t('quickPanel.sectionsLabel')}
            className="quick-panel-section-bar absolute top-0 right-0 flex max-w-3/4 gap-0.5 overflow-x-auto"
            onScroll={markEdges}
            onWheel={(event) => scrollBy(event.deltaY)}
          >
            {sections.map((section, index) => {
              const current = index === highlight;
              return (
                <span
                  key={section.id}
                  data-current={current || undefined}
                  className="relative flex shrink-0"
                >
                  {current && (
                    // The pressed ghost fill, drawn as the same 22px circle as the hover wash.
                    <motion.span
                      layoutId={capsule}
                      transition={SLIDE}
                      className="absolute inset-0.75 rounded-full bg-muted dark:bg-input"
                    />
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <IconButton
                        label={section.heading}
                        tooltip={false}
                        tabIndex={-1}
                        aria-current={current ? 'true' : undefined}
                        // The 28px button stays the target, but its fills sit inside it as 22px
                        // circles (quick-panel.css), 3px clear of the row's edges, so they never
                        // meet the first row's highlight below; its own full-size hover is off.
                        className={cn(
                          'relative hover:bg-transparent dark:hover:bg-transparent',
                          current ? 'text-foreground' : 'text-muted-foreground',
                        )}
                        onClick={() => onPick(index)}
                      >
                        <span className="quick-panel-section-fill flex size-5.5 items-center justify-center rounded-full">
                          {section.icon}
                        </span>
                      </IconButton>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={4} onEscapeKeyDown={onDismiss}>
                      {section.heading}
                    </TooltipContent>
                  </Tooltip>
                </span>
              );
            })}
          </motion.div>
        </MotionConfig>
      )}
    </div>
  );
}
