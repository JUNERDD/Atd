import type { ReactNode } from 'react';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { cn } from '@atd/ui/lib/utils';
import { CopyButton } from '../../copy-button';

/**
 * The scrolling content region. `scroll` picks the axis: `y` for wrapped text and lists, `both`
 * for code whose lines keep their width, `none` for content that scrolls itself (a `CodeBlock`
 * with its own height). `size` caps the height: `sm` 160px, `md` 240px (default), `lg` 320px.
 * `flush` drops the content inset for rendered code, whose own line backgrounds then meet the
 * card's hairline. Without a header, `copyText` puts the copy action on the body's corner instead.
 */
export function Body({
  scroll = 'y',
  size = 'md',
  flush = false,
  copyText,
  className,
  children,
}: {
  scroll?: 'y' | 'both' | 'none';
  size?: 'sm' | 'md' | 'lg';
  flush?: boolean;
  copyText?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const content = (
    <div className={cn('tool-card-content', flush && 'tool-card-flush', className)}>{children}</div>
  );
  return (
    <div data-slot="tool-card-body" data-size={size} className="tool-card-body">
      {scroll === 'none' ? (
        content
      ) : (
        <ScrollArea
          orientation={scroll === 'both' ? 'both' : 'vertical'}
          className="tool-card-scroll"
          viewportClassName="max-h-[inherit]"
          gutter="stable"
          scrollShadow={scroll === 'y'}
        >
          {content}
        </ScrollArea>
      )}
      {copyText && <CopyButton text={copyText} />}
    </div>
  );
}
