import type { ReactNode } from 'react';
import { cn } from '@atd/ui/lib/utils';

/** A closing note under a hairline; `tone="destructive"` for a failure such as a non-zero exit. */
export function Footer({
  tone = 'muted',
  className,
  children,
}: {
  tone?: 'muted' | 'destructive';
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="tool-card-footer"
      data-tone={tone}
      className={cn('tool-card-footer', className)}
    >
      {children}
    </div>
  );
}
