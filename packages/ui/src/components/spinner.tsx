import { cn } from '@atd/ui/lib/utils';
import { Loader2Icon } from 'lucide-react';

/**
 * Decorative loading indicator. It carries no status role (the project lint prefers `<output>`
 * for that), so a caller names the state in visible text next to it.
 */
function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <Loader2Icon
      data-slot="spinner"
      aria-hidden
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  );
}

export { Spinner };
