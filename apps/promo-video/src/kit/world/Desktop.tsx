import type { ReactNode } from 'react';
import type { Lang } from '../../copy.ts';
import { MAC_CHROME } from './chrome.ts';
import { Light } from './Light.tsx';
import type { Mood, MoodWeights } from './light-field.ts';
import { MenuBar, type MenuBarProps } from './MenuBar.tsx';
import { DISPLAY, FRAME_SCALE } from './points.ts';
import './desktop.css';

interface DesktopProps extends Partial<MenuBarProps> {
  /** The cut's language: the menu bar's Finder, menus and resting clock follow it. */
  lang: Lang;
  /** Seconds, section-local: the wallpaper's light drifts on it. */
  t: number;
  /** The wallpaper's mood or blend (see `Light`). Default `bright`. */
  mood?: Mood | MoodWeights;
  /** The wallpaper's brightness (see `Light`). */
  intensity?: number;
  /** The wallpaper's grain, 0–1 (default 0.35). */
  grain?: number;
  /** The display dimming toward sleep, 0 (awake) → 1 (dim, vignetted). It dims everything. */
  dim?: number;
  /** Hides the menu bar (default shown). */
  menuBar?: boolean;
  /** The clock string; default the language's resting time ("Fri Oct 10  9:41"). */
  clock?: string;
  /**
   * What is on the screen, laid out in points on the 1512 × 982 pt display (absolutely
   * positioned; `MacWindow`, icons, the panel, the cursor). It sits under the menu bar.
   */
  children?: ReactNode;
}

/**
 * The Mac's display: the light as wallpaper, the menu bar with Atd's status item, and whatever the
 * scene places on it, all in points, scaled once to fill the frame's width (FRAME_SCALE ≈ 1.27).
 * Its top-left is its parent's top-left; the bottom 131.5 pt fall below a 1080 px frame (see
 * `points.ts`). Put it inside `Camera` to move over it; zoom stays crisp, as everything is DOM/SVG.
 */
export function Desktop({
  lang,
  t,
  mood = 'bright',
  intensity,
  grain = 0.35,
  dim = 0,
  menuBar = true,
  clock = MAC_CHROME[lang].clock,
  children,
  ...bar
}: DesktopProps) {
  return (
    <div
      className="desktop"
      style={{ '--scale': FRAME_SCALE, '--dw': DISPLAY.width, '--dh': DISPLAY.height }}
    >
      <Light t={t} mood={mood} grain={grain} {...(intensity === undefined ? {} : { intensity })} />
      <div className="desktop__screen">{children}</div>
      {menuBar ? (
        <MenuBar
          clock={clock}
          appName={MAC_CHROME[lang].finder}
          menus={MAC_CHROME[lang].menus.finder}
          {...bar}
        />
      ) : null}
      {dim > 0 ? <div className="desktop__dim" style={{ '--dim': dim }} /> : null}
    </div>
  );
}
