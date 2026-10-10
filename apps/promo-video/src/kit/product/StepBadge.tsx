import { springs } from '../../motion/spring.ts';
import type { AnnotationColor } from './AnnotationToolbar.tsx';
import { arrival, present } from './motion.ts';
import './tokens.css';
import './capture.css';

export interface StepBadgeProps {
  /** The step's number. */
  number: number;
  /** Its centre, in its parent's points. */
  x: number;
  y: number;
  /** The disc's diameter: 28 pt at the shell's default size. */
  diameter?: number | undefined;
  color?: AnnotationColor | undefined;
  /** Seconds since it was placed: it pops in. */
  age?: number | undefined;
}

/**
 * A Step Number mark (`AnnotationRenderer.drawStep`): a disc in the mark's colour with its number in
 * bold at 55% of the diameter, white on dark colours and black on light ones. Positioned
 * absolutely by its centre in its parent.
 */
export function StepBadge({ number, x, y, diameter = 28, color = 'red', age }: StepBadgeProps) {
  if (!present(age)) return null;
  return (
    <span
      className="pk-step"
      data-color={color}
      style={{ '--cx': x, '--cy': y, '--d': diameter, '--pop': arrival(age, springs.pop) }}
    >
      {number}
    </span>
  );
}
