import { clamp01 } from '../../motion/ease.ts';
import type { Box } from '../../ui/Move.tsx';
import './tokens.css';
import './capture.css';

export interface SpotlightOverlayProps {
  /** The spotlit rectangle, in its parent's points (the capture's box). */
  rect: Box;
  /** The spotlight drawing in, 0 → 1: the dim fades up and the rectangle opens from its middle. */
  progress?: number | undefined;
}

/**
 * The annotation Spotlight (`AnnotationRenderer.dim`): the capture darkened by 50% everywhere but
 * the spotlit rectangle, with a sharp edge. Fills its parent, which should be the capture's box.
 */
export function SpotlightOverlay({ rect, progress = 1 }: SpotlightOverlayProps) {
  const p = clamp01(progress);
  const open = 0.85 + 0.15 * p;
  const width = rect.width * open;
  const height = rect.height * open;
  return (
    <div className="pk-capture">
      <div
        className="pk-capture__hole"
        style={{
          '--x': rect.x + (rect.width - width) / 2,
          '--y': rect.y + (rect.height - height) / 2,
          '--w': width,
          '--h': height,
          '--dim': 0.5,
          '--o': p,
        }}
      />
    </div>
  );
}
