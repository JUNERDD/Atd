import type { ReactNode } from 'react';
import type { Lang } from '../../../copy.ts';
import type { TileSpec } from './layout.ts';

/** What every vignette is given: the cut's language, the clock, its tile's age and turns. */
export interface VignetteProps {
  lang: Lang;
  /** Section-local seconds. */
  t: number;
  /** Seconds since its tile arrived. */
  age: number;
  /** How many times its tile has turned over. */
  turned: number;
  spec: TileSpec;
}

/**
 * A box laid out at `width` × `height` and scaled by `scale` from its top-left, so product
 * surfaces keep their real sizes in points while filling a tile; `x`, `y` place it in the tile's
 * content px.
 */
export function Fit({
  width,
  height,
  scale = 1,
  x = 0,
  y = 0,
  children,
}: {
  width: number;
  height: number;
  scale?: number;
  x?: number;
  y?: number;
  children: ReactNode;
}) {
  return (
    <div
      className="r08-every-v__fit"
      style={{
        '--ev-fw': width,
        '--ev-fh': height,
        '--ev-fs': scale,
        '--ev-fx': x,
        '--ev-fy': y,
      }}
    >
      {children}
    </div>
  );
}
