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
}) {
  return (
    <ScrollAreaRoot {...props}>
      <ScrollAreaViewport
        ref={viewportRef}
        className={cn(
          gutter && orientation !== 'horizontal' && 'pr-3',
          orientation !== 'vertical' && '[&>div]:table!',
          viewportClassName,
        )}
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
