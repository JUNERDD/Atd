import { useLayoutEffect, useRef } from 'react';
import { hash01 } from '../../motion/ease.ts';
import { HEIGHT, WIDTH } from '../timeline.ts';
import { DOT_PITCH, DOT_RADIUS, pulseRing, ringLight, type Pulse, type PulseRing } from './dots.ts';
import './release.css';
import './dot-field.css';

/** Where the field is seen from: the world point at the frame's center and a zoom (a `CameraState` fits). */
export interface FieldView {
  x: number;
  y: number;
  zoom: number;
}

interface DotFieldProps {
  /** Seconds on the caller's clock: the drift, the twinkle and the pulses run on it. */
  t: number;
  /** Rings of light, origins in world frame px (the grid's own space, unaffected by drift). */
  pulses?: readonly Pulse[];
  /** The view; default the rest view (960, 540, ×1). Redrawn per frame, so zooms stay crisp. */
  view?: FieldView;
  /** The dots' visibility, 0–1, for fading the grid in from black (default 1). */
  opacity?: number;
  /** The drift's speed multiplier (default 1; 0 holds the grid still, aligned with `Stage`). */
  drift?: number;
  /** How many dots glint now and then, 0–1 (default 0.5). */
  twinkle?: number;
  /** The vignette's strength, 0–1 (default 1). */
  vignette?: number;
  /** A motion streak in frame px: dots draw as short strokes along it, for whips (default none). */
  streak?: { x: number; y: number };
}

/** The drift, in world px per second: slow enough to feel rather than see. */
const DRIFT = { x: 6.5, y: -3.2 };
const REST: FieldView = { x: WIDTH / 2, y: HEIGHT / 2, zoom: 1 };

interface Lit {
  x: number;
  y: number;
  r: number;
  white: number;
  coral: number;
}

/** Each dot's light from every live ring, its push away from the origins, and its glint. */
function lightDots(
  t: number,
  pulses: readonly Pulse[],
  view: FieldView,
  drift: number,
  twinkle: number,
) {
  const rings: [Pulse, PulseRing][] = [];
  for (const pulse of pulses) {
    const ring = pulseRing(pulse, t);
    if (ring) rings.push([pulse, ring]);
  }
  const { zoom } = view;
  const dx = DRIFT.x * drift * t;
  const dy = DRIFT.y * drift * t;
  const halfW = WIDTH / 2 / zoom;
  const halfH = HEIGHT / 2 / zoom;
  const firstI = Math.floor((view.x - halfW - dx) / DOT_PITCH - 1);
  const lastI = Math.ceil((view.x + halfW - dx) / DOT_PITCH + 1);
  const firstJ = Math.floor((view.y - halfH - dy) / DOT_PITCH - 1);
  const lastJ = Math.ceil((view.y + halfH - dy) / DOT_PITCH + 1);
  const radius = Math.max(0.55, DOT_RADIUS * zoom);
  const dots: Lit[] = [];
  for (let j = firstJ; j <= lastJ; j++) {
    for (let i = firstI; i <= lastI; i++) {
      const wx = (i + 0.5) * DOT_PITCH + dx;
      const wy = (j + 0.5) * DOT_PITCH + dy;
      let white = 0;
      let coral = 0;
      let px = 0;
      let py = 0;
      for (const [pulse, ring] of rings) {
        const ox = wx - pulse.x;
        const oy = wy - pulse.y;
        const distance = Math.hypot(ox, oy);
        const light = ringLight(ring, distance);
        if (light < 0.004) continue;
        if (pulse.tint === 'coral') coral += light;
        else white += light;
        // The ring pushes the dots it passes outward by a few px, the ripple's swell.
        const push = (light * 2.6) / Math.max(1, distance);
        px += ox * push;
        py += oy * push;
      }
      if (twinkle > 0) {
        const phase = hash01(i * 7919 + j * 104729);
        const wave = Math.sin(2 * Math.PI * (t * 0.21 + phase));
        if (wave > 0.96) white += twinkle * ((wave - 0.96) / 0.04) ** 2 * 0.55;
      }
      const lit = Math.min(1.6, white + coral);
      dots.push({
        x: (wx + px - view.x) * zoom + WIDTH / 2,
        y: (wy + py - view.y) * zoom + HEIGHT / 2,
        r: radius * (1 + 0.85 * lit),
        white: Math.min(1, white),
        coral: Math.min(1, coral),
      });
    }
  }
  return dots;
}

type Paint = (dot: Lit) => void;

/**
 * The world's backdrop: graphite ink, a fine dot grid drifting slowly under a vignette, dots that
 * glint now and then, and pulses that ripple out from events. Drawn on a canvas from `t` alone, so
 * any frame renders on its own, and redrawn at the view's zoom instead of scaled, so it stays crisp
 * under a push-in. Fills its parent (a full frame).
 */
export function DotField({
  t,
  pulses = [],
  view = REST,
  opacity = 1,
  drift = 1,
  twinkle = 0.5,
  vignette = 1,
  streak,
}: DotFieldProps) {
  const canvas = useRef<HTMLCanvasElement>(null);

  // Drawn after every render, before the frame is captured.
  useLayoutEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const style = getComputedStyle(element);
    const colors = {
      dot: style.getPropertyValue('--r08-dot'),
      hot: style.getPropertyValue('--r08-dot-hot'),
      coral: style.getPropertyValue('--r08-dot-coral'),
    };
    context.clearRect(0, 0, WIDTH, HEIGHT);
    const dots = lightDots(t, pulses, view, drift, twinkle);
    const long = streak && Math.hypot(streak.x, streak.y) > 0.75;
    const shape: Paint = long
      ? ({ x, y }) => {
          context.moveTo(x - streak.x / 2, y - streak.y / 2);
          context.lineTo(x + streak.x / 2, y + streak.y / 2);
        }
      : ({ x, y, r }) => {
          context.moveTo(x + r, y);
          context.arc(x, y, r, 0, Math.PI * 2);
        };
    const pass = (color: string, alpha: (dot: Lit) => number) => {
      context.fillStyle = color;
      context.strokeStyle = color;
      // Group by alpha in steps, so lit dots cost a handful of fills rather than one each.
      const groups = new Map<number, Lit[]>();
      for (const dot of dots) {
        const level = Math.round(Math.min(1, alpha(dot)) * 24);
        if (level <= 0) continue;
        const group = groups.get(level);
        if (group) group.push(dot);
        else groups.set(level, [dot]);
      }
      for (const [level, group] of groups) {
        context.globalAlpha = level / 24;
        context.beginPath();
        for (const dot of group) {
          context.lineWidth = dot.r * 2;
          shape(dot);
        }
        if (long) context.stroke();
        else context.fill();
      }
    };
    context.lineCap = 'round';
    pass(colors.dot, () => 1);
    pass(colors.hot, (dot) => dot.white * 0.92);
    pass(colors.coral, (dot) => dot.coral);
    context.globalAlpha = 1;
  });

  return (
    <div className="r08-dots" style={{ '--dots-o': opacity, '--vig': vignette }}>
      <canvas ref={canvas} className="r08-dots__canvas" width={WIDTH} height={HEIGHT} />
      <div className="r08-dots__vignette" />
    </div>
  );
}
