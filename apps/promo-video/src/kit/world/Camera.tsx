import { useId, type ReactNode } from 'react';
import { cameraBlur, type CameraState } from './camera.ts';
import './camera.css';

interface CameraProps {
  /** From `cameraAt(t, shots)`. */
  state: CameraState;
  /** Velocity-driven motion blur for whips and dives (default on). */
  motionBlur?: boolean;
  /**
   * The world: laid out in frame pixels on a 1920 × 1080 container whose top-left is the world's
   * origin (a `Desktop` placed here fills it). Content may extend beyond it.
   */
  children: ReactNode;
}

/**
 * A 2.5D camera over a world container: it centers the shot's point, zooms, tilts in perspective
 * about that point, and blurs along its own motion (directional, from the springs' exact velocity)
 * plus any depth blur the shot asks for. DOM content is re-rasterized at the zoomed scale, so
 * close-ups of type and SVG stay crisp.
 */
export function Camera({ state, motionBlur = true, children }: CameraProps) {
  const id = useId().replace(/[^\w-]/g, '');
  const motion = motionBlur ? cameraBlur(state) : { x: 0, y: 0 };
  const sx = Math.hypot(motion.x, state.blur);
  const sy = Math.hypot(motion.y, state.blur);
  // Below half a pixel the blur is invisible; skipping it keeps resting shots pixel-sharp.
  const filtered = sx > 0.5 || sy > 0.5;
  // Any 3D transform makes the browser rasterize the world before zooming it, softening type, so
  // a shot without tilt stays a plain 2D transform.
  const flat = Math.abs(state.rotateX) < 0.01 && Math.abs(state.rotateY) < 0.01;
  return (
    <div className="camera">
      {filtered ? (
        <svg className="camera__defs" aria-hidden="true">
          <filter
            id={id}
            x="-2%"
            y="-2%"
            width="104%"
            height="104%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation={`${sx.toFixed(2)} ${sy.toFixed(2)}`} />
          </filter>
        </svg>
      ) : null}
      <div
        className="camera__lens"
        data-flat={flat ? '' : undefined}
        style={{ '--cam-filter': filtered ? `url(#${id})` : 'none' }}
      >
        <div
          className="camera__world"
          style={{
            '--cx': state.x,
            '--cy': state.y,
            '--zoom': state.zoom,
            '--rx': `${state.rotateX}deg`,
            '--ry': `${state.rotateY}deg`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
