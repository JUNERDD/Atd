import * as React from 'react';
import { cn } from '@atd/ui/lib/utils';
import { ignoreComposingEscape, isComposingKey } from '@atd/ui/lib/ime';
import {
  createPointerGate,
  gateItemPointerProps,
  type PointerGate,
} from '@atd/ui/lib/pointer-gate';
import { Select as SelectPrimitive } from 'radix-ui';
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from 'lucide-react';
import { ScrollAreaRoot, ScrollAreaViewport, ScrollBar } from '@atd/ui/components/scroll-area';

const SelectPointerGateContext = React.createContext<PointerGate | null>(null);

const SELECT_NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

function resolveSelectNavTarget(items: HTMLElement[], key: string): HTMLElement | undefined {
  const index =
    document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1;
  if (key === 'Home') return items[0];
  if (key === 'End') return items.at(-1);
  if (key === 'ArrowDown') return index >= 0 ? items[(index + 1) % items.length] : items[0];
  return index >= 0 ? items[(index - 1 + items.length) % items.length] : items.at(-1);
}

function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn('scroll-my-1.5', className)}
      {...props}
    />
  );
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: 'sm' | 'default';
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-2xl border border-foreground/8 bg-input/50 px-3 py-2 text-sm whitespace-nowrap transition-[color,background-color,box-shadow] duration-200 outline-none hover:bg-input/75 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:border-transparent dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = 'popper',
  align = 'center',
  sideOffset = 4,
  collisionPadding = 8,
  onEscapeKeyDown,
  onKeyDown,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const [pointerGate] = React.useState(() => createPointerGate(true));
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-align-trigger={position === 'item-aligned'}
        className={cn(
          'relative z-50 flex max-h-(--radix-select-content-available-height) w-max min-w-[min(max(9rem,var(--radix-select-trigger-width,0px)),calc(100vw-16px))] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-2xl surface-glass p-1 text-popover-foreground',
          className,
        )}
        position={position}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...props}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (
            event.defaultPrevented ||
            isComposingKey(event) ||
            event.ctrlKey ||
            event.altKey ||
            event.metaKey
          ) {
            return;
          }
          if (event.key.length === 1) {
            pointerGate.lock();
            return;
          }
          if (!SELECT_NAV_KEYS.has(event.key)) return;
          event.preventDefault();
          pointerGate.lock();
          const items = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              '[data-slot="select-item"]:not([data-disabled])',
            ),
          ];
          if (items.length === 0) return;
          const target = resolveSelectNavTarget(items, event.key);
          const viewport = event.currentTarget.querySelector<HTMLElement>(
            '[data-radix-select-viewport]',
          );
          target?.scrollIntoView?.({ block: 'nearest' });
          if (target === items[0] && viewport) viewport.scrollTop = 0;
          if (target === items.at(-1) && viewport) viewport.scrollTop = viewport.scrollHeight;
          target?.focus({ preventScroll: true });
        }}
        onEscapeKeyDown={ignoreComposingEscape(onEscapeKeyDown)}
      >
        <SelectPointerGateContext.Provider value={pointerGate}>
          <ScrollAreaRoot className="flex min-h-0 flex-1 flex-col">
            <SelectPrimitive.Viewport asChild>
              <SelectScrollViewport className="h-auto min-h-0 flex-1" gutter="none">
                {children}
              </SelectScrollViewport>
            </SelectPrimitive.Viewport>
            <ScrollBar />
          </ScrollAreaRoot>
        </SelectPointerGateContext.Provider>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

/**
 * Select's viewport and the scroll area's are one element. Radix Select styles its viewport
 * inline (`position: relative; flex: 1; overflow: hidden auto`), while the scroll area sets
 * overflow per axis and changes it when its bar mounts; on one element the shorthand and those
 * longhands depend on the order React applied them, and React warns wherever a Select renders.
 * So Select's inline style stays out: its position becomes a class (the scroll area's viewport
 * already flexes), and the scroll area alone owns overflow.
 */
function SelectScrollViewport({
  style: _selectStyle,
  className,
  ...props
}: React.ComponentProps<typeof ScrollAreaViewport>) {
  return <ScrollAreaViewport className={cn('relative', className)} {...props} />;
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn('px-2 py-1 text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & {
  variant?: 'default' | 'destructive';
}) {
  const gate = React.useContext(SelectPointerGateContext);
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      data-variant={variant}
      className={cn(
        "relative flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-xl py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:min-w-0 *:[span]:last:wrap-anywhere *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
      {...gateItemPointerProps(gate, props.onPointerMove, props.onPointerLeave, false)}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText className="min-w-0 flex-1">
        <span
          className="block min-w-0 truncate"
          title={typeof children === 'string' ? children : undefined}
        >
          {children}
        </span>
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('pointer-events-none -mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
