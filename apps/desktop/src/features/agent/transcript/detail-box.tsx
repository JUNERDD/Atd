import type { ReactNode } from 'react';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { cn } from '@ai/ui/lib/utils';
import { CopyButton } from './copy-button';

export type DetailBoxVariant = 'output' | 'diff' | 'plain';

/**
 * The single shared desc box behind every tool body and thinking detail: one tinted region with
 * an optional copy button that reveals on hover. Variants only change the skin/scroll contract,
 * never the shape: `output` scrolls a muted box with dense output typography, `diff` scrolls a
 * bordered box both ways, `plain` scrolls the same muted box for thinking text. Empty `copyText`
 * renders no button.
 */
export function DetailBox({
  variant,
  copyText,
  children,
  className,
}: {
  variant: DetailBoxVariant;
  copyText?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('group relative', className)}>
      {variant === 'plain' ? (
        <ScrollArea
          className="thinking-detail"
          viewportClassName="max-h-[inherit]"
          gutter="stable"
          scrollShadow
        >
          <div className="thinking-detail-pre">{children}</div>
        </ScrollArea>
      ) : variant === 'diff' ? (
        <ScrollArea
          orientation="both"
          className="tool-diff"
          viewportClassName="max-h-[inherit]"
          gutter="stable"
        >
          <div className="tool-diff-pre">{children}</div>
        </ScrollArea>
      ) : (
        <ScrollArea
          className="tool-output"
          viewportClassName="max-h-[inherit]"
          gutter="stable"
          scrollShadow
        >
          <div className="tool-output-pre m-0 flex flex-col gap-2 text-xs leading-4.5">
            {children}
          </div>
        </ScrollArea>
      )}
      {copyText && <CopyButton text={copyText} />}
    </div>
  );
}
