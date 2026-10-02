import * as React from 'react';
import { Toolbar as ToolbarPrimitive } from 'radix-ui';
import { cn } from '@atd/ui/lib/utils';

/**
 * A row of controls with one tab stop: Radix moves focus between its buttons with the arrow keys
 * (and Home/End), looping by default. It adds no surface of its own; the owner supplies it.
 */
function Toolbar({ className, ...props }: React.ComponentProps<typeof ToolbarPrimitive.Root>) {
  return (
    <ToolbarPrimitive.Root
      data-slot="toolbar"
      className={cn('flex items-center gap-0.5', className)}
      {...props}
    />
  );
}

/** A toolbar stop; pass `asChild` to make an existing button (an `IconButton`) the stop. */
function ToolbarButton({ ...props }: React.ComponentProps<typeof ToolbarPrimitive.Button>) {
  return <ToolbarPrimitive.Button data-slot="toolbar-button" {...props} />;
}

export { Toolbar, ToolbarButton };
