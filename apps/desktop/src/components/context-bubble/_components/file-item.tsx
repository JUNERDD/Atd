import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@ai/ui/lib/utils';
import { useContextBubble } from '../_hooks/use-context-bubble';
import type { ContextBubbleFile } from '../_types/context';

export interface ContextBubbleFileItemProps extends ComponentProps<'li'> {
  /** File identity; structurally compatible with the agent `FileRef`. */
  file: ContextBubbleFile;
  /** Secondary line such as a formatted size; omit when not needed. */
  detail?: ReactNode;
}

/**
 * Default renderer for one attached file. Renders the file name plus optional
 * detail and action children (for example a remove button). Replaceable: a
 * consumer may render its own `<li>` inside Files instead.
 */
export function FileItem({
  file,
  detail,
  className,
  style,
  children,
  ...props
}: ContextBubbleFileItemProps) {
  useContextBubble();
  return (
    <li
      {...props}
      data-slot="context-bubble-file-item"
      className={cn('flex min-w-0 items-center gap-2 text-sm', className)}
      style={style}
    >
      <span className="min-w-0 flex-1 truncate" title={file.name}>
        {file.name}
      </span>
      {detail}
      {children}
    </li>
  );
}
