import type { ComponentProps } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@atd/ui/lib/utils';
import { useActivityRow } from '../_hooks/use-activity-row';

export interface ActivityRowIconProps extends ComponentProps<'span'> {
  /**
   * Whether to overlay the expanding chevron on hover. Rows that never expand hide it so the
   * icon box keeps its geometry without implying an interaction. Defaults to true.
   */
  chevron?: boolean;
}

/**
 * Leading icon box: renders the type icon from children and overlays the
 * expanding chevron in the same box. Carries no icon-type knowledge.
 */
export function Icon({
  chevron = true,
  className,
  style,
  children,
  ...props
}: ActivityRowIconProps) {
  const { state } = useActivityRow();
  return (
    <span
      {...props}
      data-slot="activity-row-icon"
      data-state={state.open ? 'open' : 'closed'}
      className={cn('row-icon-swap', className)}
      style={style}
    >
      {children}
      {chevron && (
        <ChevronRight strokeWidth={1.75} className={cn('row-chevron', state.open && 'rotate-90')} />
      )}
    </span>
  );
}
