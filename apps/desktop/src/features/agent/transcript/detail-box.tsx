import type { ReactNode } from 'react';
import { ToolCard } from './tool-card';

export type DetailBoxVariant = 'output' | 'plain';

/**
 * The desc box for detail that is not a tool body: reasoning, compaction summaries, approval and
 * question detail, the JSON fallback. It is a headerless `ToolCard`, so every detail surface in
 * the transcript shares one fill, hairline, corner, content inset and corner copy action (hidden
 * until the box is hovered or focused; empty `copyText` renders none). `output` holds dense
 * output text in the host's color; `plain` holds prose in the secondary tone (`.thinking-detail`
 * in `agent.css`). `size` caps the height like `ToolCard.Body` (default `md`, 240px).
 */
export function DetailBox({
  variant,
  size = 'md',
  copyText,
  children,
  className,
}: {
  variant: DetailBoxVariant;
  size?: 'sm' | 'md';
  copyText?: string | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ToolCard.Root className={className}>
      <ToolCard.Body
        size={size}
        copyText={copyText}
        className={variant === 'plain' ? 'thinking-detail' : 'flex flex-col gap-2'}
      >
        {children}
      </ToolCard.Body>
    </ToolCard.Root>
  );
}
