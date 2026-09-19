import type { ComponentProps } from 'react';
import { CollapsibleContent } from '@ai/ui/components/collapsible';
import { useActivityRow } from '../_hooks/use-activity-row';

export type ActivityRowContentProps = ComponentProps<typeof CollapsibleContent>;

/**
 * Transparent Radix content host: keeps the ui
 * `[data-slot=collapsible-content]` height keyframes and carries no layout
 * opinion of its own.
 */
export function Content({ id, children, ...props }: ActivityRowContentProps) {
  const { meta } = useActivityRow();
  return (
    <CollapsibleContent {...props} id={id ?? meta.contentId}>
      {children}
    </CollapsibleContent>
  );
}
