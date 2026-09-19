import * as React from 'react';
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import { cn } from '@ai/ui/lib/utils';

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

function ScrollAreaViewport({
  className,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Viewport>) {
  return (
    <ScrollAreaPrimitive.Viewport
      data-slot="scroll-area-viewport"
      className={cn(
        'min-h-0 w-full min-w-0 flex-1 rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 [&>div]:block!',
        className,
      )}
      {...props}
    />
  );
}

function ScrollArea({
  children,
  viewportClassName,
  viewportRef,
  viewportProps,
  orientation = 'vertical',
  gutter = false,
  scrollShadow = false,
  ...props
}: React.ComponentProps<typeof ScrollAreaRoot> & {
  viewportClassName?: string;
  viewportRef?: React.Ref<HTMLDivElement>;
  viewportProps?: Omit<
    React.ComponentProps<typeof ScrollAreaViewport>,
    'children' | 'className' | 'ref'
  >;
  orientation?: 'vertical' | 'horizontal' | 'both';
  /** Reserve a trailing column so the vertical bar never covers content. */
  gutter?: boolean;
  /** Soft content fade at the scrolled edges revealing further content (vertical only). */
  scrollShadow?: boolean;
}) {
  const viewportNode = React.useRef<HTMLDivElement | null>(null);
  const setViewportRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      viewportNode.current = node;
      setRef(viewportRef, node);
    },
    [viewportRef],
  );
  const shadows = scrollShadow && orientation !== 'horizontal';
  const edges = useScrollEdges(shadows, viewportNode);
  const top = shadows && (edges & 1) !== 0;
  const bottom = shadows && (edges & 2) !== 0;
  return (
    <ScrollAreaRoot {...props}>
      <ScrollAreaViewport
        ref={setViewportRefs}
        className={cn(
          gutter && orientation !== 'horizontal' && 'pr-3',
          orientation !== 'vertical' && '[&>div]:table!',
          shadows && 'scroll-shadowed',
          viewportClassName,
        )}
        {...viewportProps}
        data-top-scroll={top || undefined}
        data-bottom-scroll={bottom || undefined}
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

/** Assigns a forwarded ref without the caller touching props inline. */
function setRef(ref: React.Ref<HTMLDivElement> | undefined, node: HTMLDivElement | null) {
  if (typeof ref === 'function') {
    ref(node);
  } else if (ref) {
    ref.current = node;
  }
}

/**
 * Bit 0: more content above; bit 1: more below. A number compares by value, which is what the
 * external-store snapshot below needs.
 */
function scrollEdges(node: HTMLDivElement | null): number {
  if (!node) return 0;
  const top = node.scrollTop > SHADOW_EDGE_PX ? 1 : 0;
  const bottom = node.scrollTop + node.clientHeight < node.scrollHeight - SHADOW_EDGE_PX ? 2 : 0;
  return top | bottom;
}

/**
 * Edge-overflow bits for a scrollable viewport, read through `useSyncExternalStore`: scroll
 * events and viewport resizes notify, and every render re-reads the snapshot, which also covers
 * content growing under a settled scroll position. The snapshot is a 2-bit number, so unchanged
 * scrolls never re-render. Mirrors HeroUI's `useScrollShadow` state model (`data-top-scroll` /
 * `data-bottom-scroll`) without its MutationObserver — renders already re-read here.
 */
function useScrollEdges(enabled: boolean, target: React.RefObject<HTMLDivElement | null>): number {
  const subscribe = React.useCallback(
    (notify: () => void) => {
      if (!enabled) return () => {};
      const node = target.current;
      if (!node) return () => {};
      node.addEventListener('scroll', notify, { passive: true });
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(notify);
      observer?.observe(node);
      return () => {
        node.removeEventListener('scroll', notify);
        observer?.disconnect();
      };
    },
    [enabled, target],
  );
  const getEdges = React.useCallback(
    () => (enabled ? scrollEdges(target.current) : 0),
    [enabled, target],
  );
  return React.useSyncExternalStore(subscribe, getEdges);
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
        className="relative flex-1 rounded-full bg-border transition-colors group-hover/scrollbar:bg-muted-foreground/50 active:bg-muted-foreground/70"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollAreaRoot, ScrollAreaViewport, ScrollBar };
