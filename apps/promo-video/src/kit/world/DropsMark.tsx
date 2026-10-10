import { useId } from 'react';
import { Easing } from 'remotion';
import { clamp01 } from '../../motion/ease.ts';
import { boxPercent, DROP_CENTROIDS, DROP_PATHS, DROPS_VIEWBOX, type DropId } from './drops.ts';
import './drops.css';

/** The share of `formation` spent travelling; the rest is the lock and its glint. */
const TRAVEL = 0.78;
const GHOSTS = 4;
const travelEase = Easing.bezier(0.5, 0, 0.12, 1);

interface DropsMarkProps {
  /**
   * 0 → 1: the two drops of light fly in on curved paths from opposite corners (until 0.78),
   * spinning and growing into place, then lock with a swell and a glint that runs out along the
   * seam, the straight edges the two drops share on the center's horizontal and vertical (0.78 → 1).
   * Drive it with a linear ramp over the formation's length (≈ 1.2 s), not a spring: the travel
   * eases internally. Values outside 0–1 clamp.
   */
  formation: number;
  /** 0 → 1 after formation: the coral and cyan light cools to white. */
  settle?: number;
  /** A soft halo around the settled mark, 0–1. */
  glow?: number;
  /** The mark's box, in px (or points inside `Desktop`). Default 280. */
  size?: number;
  /** How far away the drops start, in mark sizes (default 3.6, outside a full frame). */
  reach?: number;
}

interface DropPose {
  x: number;
  y: number;
  rotate: number;
  scale: number;
  blur: number;
}

/** One drop's pose at travel progress `s` (0 far away → 1 in place), in mark sizes and degrees. */
function poseAt(drop: DropId, s: number, reach: number): DropPose {
  const sign = drop === 'upper' ? -1 : 1;
  const start = { x: sign * reach, y: sign * reach * 0.56 };
  // The control point swings each path off its straight line the same way, so the pair swirl
  // about the center with the mark's own rotational symmetry.
  const control = { x: start.x * 0.5 - start.y * 0.42, y: start.y * 0.5 + start.x * 0.42 };
  const a = (1 - s) * (1 - s);
  const b = 2 * (1 - s) * s;
  return {
    x: a * start.x + b * control.x,
    y: a * start.y + b * control.y,
    rotate: (1 - s) * 240,
    scale: 0.32 + 0.68 * s,
    blur: (1 - s) * 0.045,
  };
}

/**
 * The Atd mark forming from light: two drops, coral and cyan, travel in and lock point to point,
 * then settle to white. A pure function of its progress values, which the scene derives from its
 * time (e.g. `ramp(t, CHOREO.open.drops, 1.2, (x) => x)` for `formation`). The drops are the
 * master's paths and never stretch; the box is square, sized by `size`.
 */
export function DropsMark({
  formation,
  settle = 0,
  glow = 0,
  size = 280,
  reach = 3.6,
}: DropsMarkProps) {
  const id = useId().replace(/[^\w-]/g, '');
  const f = clamp01(formation);
  const u = clamp01(f / TRAVEL);
  const lock = clamp01((f - TRAVEL) / (1 - TRAVEL));
  const swell = 1 + 0.06 * Math.sin(Math.PI * lock) * (1 - lock * 0.4);
  const glint = Math.sin(Math.PI * lock) ** 2;
  const white = clamp01(settle);

  const drop = (which: DropId, ghost: number) => {
    const s = travelEase(clamp01(u - ghost * 0.035));
    const pose = poseAt(which, s, reach);
    const centroid = DROP_CENTROIDS[which];
    const fade = ghost === 0 ? 1 : (1 - ghost / (GHOSTS + 1)) * 0.38 * (1 - lock);
    return (
      <div
        key={`${which}-${ghost}`}
        className="drops-mark__drop"
        data-drop={which}
        data-ghost={ghost > 0 ? '' : undefined}
        style={{
          '--dx': pose.x,
          '--dy': pose.y,
          '--rotate': `${pose.rotate}deg`,
          '--scale': pose.scale * (ghost === 0 ? swell : 1),
          '--blur': pose.blur + ghost * 0.012,
          '--o': fade * Math.min(1, u * 6),
          '--ox': `${boxPercent(centroid.x)}%`,
          '--oy': `${boxPercent(centroid.y)}%`,
          '--white': ghost === 0 ? white : 0,
        }}
      >
        <svg className="drops-mark__svg" viewBox={DROPS_VIEWBOX} aria-hidden="true">
          <path d={DROP_PATHS[which]} fill={`url(#${id}-${which})`} />
          <path className="drops-mark__white" d={DROP_PATHS[which]} />
        </svg>
      </div>
    );
  };

  return (
    <div
      className="drops-mark"
      style={{ '--size': `${size}px`, '--glow': glow * white, '--settle': white }}
    >
      <svg className="drops-mark__defs" aria-hidden="true">
        <defs>
          {/* Each drop's light is hottest in its bulb and deepest toward its point. */}
          <radialGradient id={`${id}-upper`} gradientUnits="userSpaceOnUse" cx="36" cy="36" r="30">
            <stop className="drops-mark__stop" data-stop="upper-core" offset="0" />
            <stop className="drops-mark__stop" data-stop="upper-edge" offset="1" />
          </radialGradient>
          <radialGradient id={`${id}-lower`} gradientUnits="userSpaceOnUse" cx="84" cy="84" r="30">
            <stop className="drops-mark__stop" data-stop="lower-core" offset="0" />
            <stop className="drops-mark__stop" data-stop="lower-edge" offset="1" />
          </radialGradient>
        </defs>
      </svg>
      {(['upper', 'lower'] as const).flatMap((which) =>
        Array.from({ length: GHOSTS + 1 }, (_, ghost) => GHOSTS - ghost).map((ghost) =>
          ghost > 0 && (u <= 0 || u >= 1) ? null : drop(which, ghost),
        ),
      )}
      {glint > 0.001 ? (
        <div className="drops-mark__glint" style={{ '--glint': glint, '--reach': lock }}>
          <span className="drops-mark__seam" data-axis="x" />
          <span className="drops-mark__seam" data-axis="y" />
          <span className="drops-mark__core" />
        </div>
      ) : null}
    </div>
  );
}
