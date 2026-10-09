import type { ReactNode } from 'react';
import { Img } from 'remotion';

/** One frame of an element's motion. Every field defaults to rest. */
export interface Motion {
  opacity?: number;
  /** Offset, in pixels. */
  x?: number;
  y?: number;
  /** Uniform scale, or x and y. */
  scale?: number | readonly [number, number];
  origin?: string;
  /** Gaussian blur radius, in pixels. */
  blur?: number;
  /** A CSS clip-path. */
  clip?: string;
  /** A reveal behind a soft edge: how far it has travelled and how wide the edge is, in percent. */
  wipe?: { edge: number; soft: number; direction: 'to right' | 'to bottom' };
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MoveProps {
  motion?: Motion;
  /** Places the element on a box of its parent; without one it fills the parent. */
  box?: Box;
  children?: ReactNode;
}

function scaleOf(scale: Motion['scale']): string | undefined {
  if (scale === undefined) return undefined;
  return typeof scale === 'number' ? String(scale) : `${scale[0]} ${scale[1]}`;
}

/** Hands an element's motion to the stylesheet as custom properties: the `.move` class applies them. */
export function Move({ motion = {}, box, children }: MoveProps) {
  return (
    <div
      className="move"
      data-box={box ? '' : undefined}
      data-wipe={motion.wipe ? '' : undefined}
      style={{
        '--bx': box?.x,
        '--by': box?.y,
        '--bw': box?.width,
        '--bh': box?.height,
        '--o': motion.opacity,
        '--x': motion.x === undefined ? undefined : `${motion.x}px`,
        '--y': motion.y === undefined ? undefined : `${motion.y}px`,
        '--s': scaleOf(motion.scale),
        '--origin': motion.origin,
        '--filter': motion.blur ? `blur(${motion.blur}px)` : undefined,
        '--clip': motion.clip,
        '--edge': motion.wipe?.edge,
        '--soft': motion.wipe?.soft,
        '--wipe': motion.wipe?.direction,
      }}
    >
      {children}
    </div>
  );
}

/** An image on its box, moving as told. */
export function MovingImage({ src, box, motion }: { src: string; box: Box; motion?: Motion }) {
  return (
    <Move box={box} {...(motion ? { motion } : {})}>
      <Img className="move__image" src={src} />
    </Move>
  );
}
