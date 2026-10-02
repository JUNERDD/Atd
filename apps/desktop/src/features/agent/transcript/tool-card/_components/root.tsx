import type { ComponentProps } from 'react';
import { cn } from '@atd/ui/lib/utils';
import '../../tool-card.css';

/**
 * The frame every expanded tool body reads in: one opaque, hairline-bordered card whose optional
 * header names what the body shows (a type glyph, a label, trailing facts and the copy action) and
 * whose optional footer carries a closing note (truncation, exit status, write result). The body
 * between them owns its own scrolling through `ToolCard.Body`. Content inside the card never adds
 * a second border or radius; the card clips it to its concentric corner.
 */
export function Root({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div {...props} data-slot="tool-card" className={cn('tool-card group', className)}>
      {children}
    </div>
  );
}
