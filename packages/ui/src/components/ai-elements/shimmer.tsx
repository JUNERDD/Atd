'use client';

// AI Elements Shimmer (Apache-2.0): https://elements.ai-sdk.dev/components/shimmer
// Copyright 2023 Vercel, Inc. Adapted for semantic colors, reduced motion and static elements.
import { cn } from '@ai/ui/lib/utils';
import { motion, useReducedMotion } from 'motion/react';
import type { CSSProperties } from 'react';
import { memo } from 'react';

const motionComponents = { p: motion.p, span: motion.span };

export interface TextShimmerProps {
  children: string;
  as?: keyof typeof motionComponents;
  className?: string;
  duration?: number;
  spread?: number;
}

const ShimmerComponent = ({
  children,
  as: Component = 'p',
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const MotionComponent = motionComponents[Component];
  const reduceMotion = useReducedMotion();
  const dynamicSpread = children.length * spread;
  const style: CSSProperties & { '--spread': string } = {
    '--spread': `${dynamicSpread}px`,
  };

  if (reduceMotion) {
    return (
      <Component
        data-slot="shimmer"
        className={cn('relative inline-block text-muted-foreground', className)}
      >
        {children}
      </Component>
    );
  }

  return (
    <MotionComponent
      data-slot="shimmer"
      animate={{ backgroundPosition: '0% center' }}
      className={cn(
        'relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent',
        '[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-foreground),#0000_calc(50%+var(--spread)))] [background-image:var(--bg),linear-gradient(var(--color-muted-foreground),var(--color-muted-foreground))] [background-repeat:no-repeat,padding-box]',
        className,
      )}
      initial={{ backgroundPosition: '100% center' }}
      style={style}
      transition={{
        duration,
        ease: 'linear',
        repeat: Number.POSITIVE_INFINITY,
      }}
    >
      {children}
    </MotionComponent>
  );
};

export const Shimmer = memo(ShimmerComponent);
