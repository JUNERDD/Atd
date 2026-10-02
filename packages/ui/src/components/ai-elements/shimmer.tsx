// AI Elements Shimmer (Apache-2.0): https://elements.ai-sdk.dev/components/shimmer
// Copyright 2023 Vercel, Inc. Adapted for semantic colors, static elements and a CSS-only
// animation (the `ai-shimmer` class and its keyframes live in `@ai/ui/styles.css`).
import { cn } from '@ai/ui/lib/utils';
import type { CSSProperties } from 'react';
import { memo } from 'react';

export interface TextShimmerProps {
  children: string;
  as?: 'p' | 'span';
  className?: string;
  /** Seconds per sweep. */
  duration?: number;
  /** Band half-width in pixels per character of `children`. */
  spread?: number;
}

const ShimmerComponent = ({
  children,
  as: Component = 'p',
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const style: CSSProperties & { '--ai-shimmer-spread': string; '--ai-shimmer-duration': string } =
    {
      '--ai-shimmer-spread': `${children.length * spread}px`,
      '--ai-shimmer-duration': `${duration}s`,
    };

  return (
    <Component
      data-slot="shimmer"
      className={cn('ai-shimmer relative inline-block', className)}
      style={style}
    >
      {children}
    </Component>
  );
};

export const Shimmer = memo(ShimmerComponent);
