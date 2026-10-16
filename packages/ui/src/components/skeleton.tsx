import { cn } from '@atd/ui/lib/utils';

/**
 * A placeholder shape that stands in for content while it loads. It is decorative: the loading
 * region that holds it names the task for assistive technology. Shapes rest at the muted fill and
 * begin a slow, low-contrast opacity pulse once a wait outlasts a moment (`animate-placeholder`),
 * which stops under Reduce Motion; there is no sweeping shimmer.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('animate-placeholder rounded-2xl bg-foreground/8', className)}
      {...props}
    />
  );
}

export { Skeleton };
