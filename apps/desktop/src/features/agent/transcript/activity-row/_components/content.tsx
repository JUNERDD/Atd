import type { ComponentProps } from 'react';
import { CollapsibleContent } from '@atd/ui/components/collapsible';
import { useActivityRow } from '../_hooks/use-activity-row';

export type ActivityRowContentProps = ComponentProps<typeof CollapsibleContent>;

/**
 * Transparent Radix content host: keeps the ui `[data-slot=collapsible-content]` unfold keyframes
 * and carries no layout opinion of its own. Those keyframes open and close the content's one grid
 * row, which can close no lower than that row's minimum height, so the children sit in a bare
 * wrapper and their own padding (the body's inset) is clipped with them instead of holding the
 * row open.
 */
export function Content({ id, children, ...props }: ActivityRowContentProps) {
  const { meta } = useActivityRow();
  return (
    <CollapsibleContent {...props} id={id ?? meta.contentId}>
      <div data-slot="activity-row-content">{children}</div>
    </CollapsibleContent>
  );
}
