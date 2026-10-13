import type { ReactNode } from 'react';
import type { Lang } from '../../copy.ts';
import { MAC_CHROME } from '../../kit/world/chrome.ts';
import { MenuBar, type MenuBarProps } from '../../kit/world/MenuBar.tsx';
import { DISPLAY, FRAME_SCALE } from '../../kit/world/points.ts';
import { DOT_PITCH, DOT_RADIUS, pulseRing, type Pulse } from './dots.ts';
import './release.css';
import './stage.css';

interface StageProps extends Partial<MenuBarProps> {
  /** The cut's language: the menu bar's app name, menus and resting clock follow it. */
  lang: Lang;
  /** Seconds on the caller's clock: the glows breathe and the pulses travel on it. */
  t: number;
  /** Hides the menu bar (default shown). */
  menuBar?: boolean;
  /** The clock string; default the language's resting time. */
  clock?: string;
  /** The wallpaper glows' strength, 0–1 and beyond (default 1). */
  glow?: number;
  /** Rings of light across the wallpaper's dots, origins in display points. */
  pulses?: readonly Pulse[];
  /** Dims the whole display, 0–1 (default 0), as when a layer takes focus over it. */
  dim?: number;
  /** What is on the screen, laid out in points on the 1512 × 982 pt display, under the menu bar. */
  children?: ReactNode;
}

/** The grid in points, so at rest it lands on exactly the frame pixels the `DotField`'s does. */
const PITCH = DOT_PITCH / FRAME_SCALE;
const RADIUS = DOT_RADIUS / FRAME_SCALE;

/**
 * The Mac's display for the film's product shots: a graphite wallpaper with the world's dot grid
 * and two very soft glows (coral low-left, cool high-right) so Liquid Glass has something to
 * refract, the menu bar with Atd's status item, and the scene's surfaces, all in points, scaled
 * once to fill the frame's width. Like `Desktop`, its top-left is its parent's; put it in a `Camera`
 * to frame it. Pulses ripple through the wallpaper's dots from events on screen (a click, the
 * island landing).
 */
export function Stage({
  lang,
  t,
  menuBar = true,
  clock = MAC_CHROME[lang].clock,
  glow = 1,
  pulses = [],
  dim = 0,
  children,
  ...bar
}: StageProps) {
  return (
    <div
      className="r08-stage"
      style={{
        '--scale': FRAME_SCALE,
        '--dw': DISPLAY.width,
        '--dh': DISPLAY.height,
        '--pitch': PITCH,
        '--dot-r': RADIUS,
        '--glow': glow,
        // The glows drift on slow, unrelated periods, so the light never visibly loops.
        '--warm-x': Math.sin(t * 0.21) * 26,
        '--warm-y': Math.cos(t * 0.17) * 14,
        '--cool-x': Math.cos(t * 0.15) * 22,
        '--cool-y': Math.sin(t * 0.23) * 16,
      }}
    >
      <div className="r08-stage__glow" data-glow="warm" />
      <div className="r08-stage__glow" data-glow="cool" />
      <div className="r08-stage__dots" />
      {pulses.map((pulse, index) => {
        const ring = pulseRing({ speed: 900, ...pulse }, t);
        if (!ring) return null;
        return (
          <div
            key={`${index}-${pulse.at}`}
            className="r08-stage__pulse"
            data-tint={pulse.tint ?? 'white'}
            style={{
              '--px': pulse.x,
              '--py': pulse.y,
              '--pr': ring.radius,
              '--pw': ring.width,
              '--lvl': Math.min(1, ring.level),
              '--flash': Math.min(1, ring.flash),
            }}
          />
        );
      })}
      <div className="r08-stage__screen">{children}</div>
      {menuBar ? (
        <MenuBar
          clock={clock}
          appName={MAC_CHROME[lang].finder}
          menus={MAC_CHROME[lang].menus.finder}
          {...bar}
        />
      ) : null}
      {dim > 0 ? <div className="r08-stage__dim" style={{ '--dim': dim }} /> : null}
    </div>
  );
}
