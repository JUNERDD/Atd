import type { ReactNode } from 'react';
import { Camera } from '../../../kit/world/Camera.tsx';
import type { CameraState } from '../../../kit/world/camera.ts';
import { DISPLAY, FRAME_SCALE } from '../../../kit/world/points.ts';
import './yours.css';

interface ShotLayerProps {
  /** From `cameraAt(t, shots)`, framed with `frameOn`. */
  state: CameraState;
  /** The shot's fade, 0–1 (a cut fades up over a few frames). */
  opacity?: number;
  /** Surfaces laid out in points on the 1512 × 982 pt display. */
  children: ReactNode;
}

/**
 * A vignette's product shot over the dot field: two soft glows (coral low, cool high) so the
 * light reads on the glass, and the surfaces seen through the camera, faded out toward the
 * statement column on the left and toward the frame's top and bottom edges, so they float.
 */
export function ShotLayer({ state, opacity = 1, children }: ShotLayerProps) {
  if (opacity <= 0) return null;
  return (
    <div className="r08-yours-shot" style={{ '--o': opacity }}>
      <div className="r08-yours-shot__glow" data-glow="warm" />
      <div className="r08-yours-shot__glow" data-glow="cool" />
      <div className="r08-yours-shot__lens">
        <Camera state={state}>
          <div
            className="r08-yours-shot__display"
            style={{ '--scale': FRAME_SCALE, '--dw': DISPLAY.width, '--dh': DISPLAY.height }}
          >
            {children}
          </div>
        </Camera>
      </div>
    </div>
  );
}
