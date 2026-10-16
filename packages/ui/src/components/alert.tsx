import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@atd/ui/lib/utils';

/**
 * Project adaptation of the Rhea alert. The root is the card and a size container; its children lay
 * out in an inner grid. A trailing action (`AlertAction`) sits beside the first line in its own
 * column once the alert is wide enough (the `@xs` container size), so text wraps before a labeled
 * button of any width; a narrower alert moves it under the text, to the bottom-right corner, instead
 * of squeezing the text into a sliver.
 */
const alertVariants = cva(
  '@container/alert relative w-full rounded-2xl border px-4 py-3 text-left text-sm',
  {
    variants: {
      variant: {
        default: 'bg-(--ata-surface-card) text-card-foreground',
        destructive:
          'bg-(--ata-surface-card) text-destructive **:data-[slot=alert-description]:text-destructive/90 **:[svg]:text-current',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Alert({
  className,
  variant,
  children,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <div className="group/alert grid gap-0.5 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4 @xs/alert:has-data-[slot=alert-action]:grid-cols-[1fr_auto] @xs/alert:has-data-[slot=alert-action]:gap-x-2.5 @xs/alert:has-[>svg]:has-data-[slot=alert-action]:grid-cols-[auto_1fr_auto]">
        {children}
      </div>
    </div>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        'col-start-1 font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'col-start-1 text-sm text-balance text-muted-foreground group-has-[>svg]/alert:col-start-2 md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Trailing action, at the trailing edge: in a narrow alert under the text in the bottom-right
 * corner, at its own width unless its label does not fit, when it takes the full width and wraps
 * the label; in a wide one in the last column beside the first line, where the negative margin
 * keeps a small button within that line's height.
 */
function AlertAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-action"
      className={cn(
        'col-span-full mt-2 max-w-full self-start justify-self-end *:h-auto *:min-h-7 *:max-w-full *:py-0.5 *:text-center *:whitespace-normal @xs/alert:col-start-auto @xs/alert:-col-end-1 @xs/alert:row-start-1 @xs/alert:-my-1',
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
