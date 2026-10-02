import * as React from 'react';
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import { cn } from '@atd/ui/lib/utils';

type ScrollOrientation = 'vertical' | 'horizontal' | 'both';

/**
 * How a scroll area keeps its bars off the content. Each bar gets a lane the width of the bar plus
 * a 4px gap, taken from the viewport so content never runs under the bar at any scroll position.
 * - `auto` (default): an axis reserves its lane while its content overflows, so areas that do not
 *   scroll keep their full width.
 * - `stable`: the lanes are always reserved, so content does not reflow when overflow starts;
 *   for page-level scrollers whose content grows and shrinks while the user works.
 * - `none`: the content's own padding already clears the bars (the panel and settings pages,
 *   whose bars float in that padding), or the bar floats over the content like a macOS overlay
 *   scroller (the option lists of menus, selects and command lists, where a lane would leave an
 *   empty strip beside every row); nothing is reserved.
 */
type ScrollGutter = 'auto' | 'stable' | 'none';

function ScrollAreaRoot({
  className,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative flex min-h-0 min-w-0 flex-col overflow-hidden', className)}
      {...props}
    />
  );
}

/**
 * The scrolling surface. It owns the bar lanes (`gutter`) and the edge fade (`scrollShadow`),
 * because both follow its own overflow; `orientation` names the axes that scroll and must match
 * the bars rendered beside it. The lane is a margin rather than padding: padding would scroll away
 * with content that also overflows along the other axis.
 */
function ScrollAreaViewport({
  className,
  ref,
  orientation = 'vertical',
  gutter = 'auto',
  scrollShadow = false,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Viewport> & {
  orientation?: ScrollOrientation;
  gutter?: ScrollGutter;
  /** Soft content fade at the scrolled edges revealing further content (vertical only). */
  scrollShadow?: boolean;
}) {
  const node = React.useRef<HTMLDivElement | null>(null);
  const setRefs = React.useCallback(
    (element: HTMLDivElement | null) => {
      node.current = element;
      setRef(ref, element);
    },
    [ref],
  );
  const scrollsY = orientation !== 'horizontal';
  const scrollsX = orientation !== 'vertical';
  const shadows = scrollShadow && scrollsY;
  const state = useViewportState(node, {
    edges: shadows,
    overflowY: gutter === 'auto' && scrollsY,
    overflowX: gutter === 'auto' && scrollsX,
  });
  const laneY = scrollsY && (gutter === 'stable' || (gutter === 'auto' && has(state, OVERFLOW_Y)));
  const laneX = scrollsX && (gutter === 'stable' || (gutter === 'auto' && has(state, OVERFLOW_X)));
  return (
    <ScrollAreaPrimitive.Viewport
      ref={setRefs}
      data-slot="scroll-area-viewport"
      className={cn(
        'min-h-0 min-w-0 flex-1 rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 [&>div]:block!',
        scrollsX && '[&>div]:table!',
        laneY && 'mr-3',
        laneX && 'mb-3',
        shadows && 'scroll-shadowed',
        className,
      )}
      {...props}
      data-top-scroll={(shadows && has(state, MORE_ABOVE)) || undefined}
      data-bottom-scroll={(shadows && has(state, MORE_BELOW)) || undefined}
    />
  );
}

function ScrollArea({
  children,
  viewportClassName,
  viewportRef,
  viewportProps,
  orientation = 'vertical',
  gutter = 'auto',
  scrollShadow = false,
  ...props
}: React.ComponentProps<typeof ScrollAreaRoot> & {
  viewportClassName?: string;
  viewportRef?: React.Ref<HTMLDivElement>;
  viewportProps?: Omit<
    React.ComponentProps<typeof ScrollAreaViewport>,
    'children' | 'className' | 'ref' | 'orientation' | 'gutter' | 'scrollShadow'
  >;
  orientation?: ScrollOrientation;
  gutter?: ScrollGutter;
  /** Soft content fade at the scrolled edges revealing further content (vertical only). */
  scrollShadow?: boolean;
}) {
  return (
    <ScrollAreaRoot {...props}>
      <ScrollAreaViewport
        ref={viewportRef}
        orientation={orientation}
        gutter={gutter}
        scrollShadow={scrollShadow}
        className={viewportClassName}
        {...viewportProps}
      >
        {children}
      </ScrollAreaViewport>
      {orientation !== 'horizontal' && <ScrollBar />}
      {orientation !== 'vertical' && <ScrollBar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaRoot>
  );
}

const SHADOW_EDGE_PX = 1;
const MORE_ABOVE = 1;
const MORE_BELOW = 2;
const OVERFLOW_Y = 4;
const OVERFLOW_X = 8;

function has(state: number, flag: number): boolean {
  return (state & flag) !== 0;
}

/** Assigns a forwarded ref without the caller touching props inline. */
function setRef(ref: React.Ref<HTMLDivElement> | undefined, node: HTMLDivElement | null) {
  if (typeof ref === 'function') {
    ref(node);
  } else if (ref) {
    ref.current = node;
  }
}

interface ViewportWatch {
  /** Track whether content lies beyond the top and bottom edges. */
  edges: boolean;
  /** Track whether content overflows vertically / horizontally. */
  overflowY: boolean;
  overflowX: boolean;
}

/**
 * Overflow bits for a viewport, as the bars see it: Radix shows a bar when the viewport's offset
 * size is below its scroll size, so a lane appears exactly when its bar can.
 */
function readViewport(node: HTMLDivElement, watch: ViewportWatch): number {
  let state = 0;
  if (watch.edges) {
    if (node.scrollTop > SHADOW_EDGE_PX) state |= MORE_ABOVE;
    if (node.scrollTop + node.clientHeight < node.scrollHeight - SHADOW_EDGE_PX)
      state |= MORE_BELOW;
  }
  if (watch.overflowY && node.offsetHeight < node.scrollHeight) state |= OVERFLOW_Y;
  if (watch.overflowX && node.offsetWidth < node.scrollWidth) state |= OVERFLOW_X;
  return state;
}

/**
 * Overflow bits for a viewport, read through `useSyncExternalStore`. Scrolls, viewport resizes and
 * content resizes (Radix wraps the children in one element) recompute them after layout, so render
 * never reads layout; the snapshot is a small number, so unchanged reads never re-render. Mirrors
 * HeroUI's `useScrollShadow` state model (`data-top-scroll` / `data-bottom-scroll`). A reserved
 * lane narrows the content, which can only make it taller, so toggling a lane settles in one pass.
 */
function useViewportState(
  target: React.RefObject<HTMLDivElement | null>,
  { edges, overflowY, overflowX }: ViewportWatch,
): number {
  const state = React.useRef(0);
  const subscribe = React.useCallback(
    (notify: () => void) => {
      const node = target.current;
      state.current = 0;
      if (!node || !(edges || overflowY || overflowX)) return () => {};
      const update = () => {
        const next = readViewport(node, { edges, overflowY, overflowX });
        if (next === state.current) return;
        state.current = next;
        notify();
      };
      update();
      if (edges) node.addEventListener('scroll', update, { passive: true });
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
      observer?.observe(node);
      if (node.firstElementChild) observer?.observe(node.firstElementChild);
      return () => {
        node.removeEventListener('scroll', update);
        observer?.disconnect();
      };
    },
    [target, edges, overflowY, overflowX],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => state.current,
    () => 0,
  );
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        'group/scrollbar flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-(--ata-scroll-thumb) transition-colors group-hover/scrollbar:bg-muted-foreground/50 active:bg-muted-foreground/70"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollAreaRoot, ScrollAreaViewport, ScrollBar, type ScrollGutter };
