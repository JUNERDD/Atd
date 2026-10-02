import * as React from 'react';
import { cn } from '@atd/ui/lib/utils';
import { ignoreComposingEscape } from '@atd/ui/lib/ime';
import { Popover as PopoverPrimitive } from 'radix-ui';

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

/**
 * The popover surface. `material` says where its glass is (see `surface-glass` in styles.css):
 * - `surface` (default): the content element is the glass, for content that keeps its size and
 *   layers while open;
 * - `backdrop`: the glass is a childless layer behind the content, which renders above it
 *   (`glass-host`). System glass hosts every layer of the element it is on, so content that
 *   expands, collapses or starts and stops scrolling while open belongs beside it, not in it.
 */
function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  collisionPadding = 8,
  onEscapeKeyDown,
  material = 'surface',
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & { material?: 'surface' | 'backdrop' }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          'z-50 flex max-h-(--radix-popover-content-available-height) w-max min-w-[min(18rem,var(--radix-popover-content-available-width))] max-w-(--radix-popover-content-available-width) origin-(--radix-popover-content-transform-origin) flex-col gap-4 rounded-3xl p-4 text-sm text-popover-foreground outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          material === 'surface' ? 'surface-glass' : 'glass-host',
          className,
        )}
        {...props}
        onEscapeKeyDown={ignoreComposingEscape(onEscapeKeyDown)}
      >
        {material === 'backdrop' && (
          <span
            aria-hidden
            data-slot="popover-backdrop"
            className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] surface-glass"
          />
        )}
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="popover-header"
      className={cn('flex flex-col gap-1 text-sm', className)}
      {...props}
    />
  );
}

function PopoverTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return (
    <div data-slot="popover-title" className={cn('text-base font-medium', className)} {...props} />
  );
}

function PopoverDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="popover-description"
      className={cn('text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
};
