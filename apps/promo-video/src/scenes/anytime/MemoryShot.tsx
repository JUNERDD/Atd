import type { Lang } from '../../copy.ts';
import { springs } from '../../motion/spring.ts';
import { Camera } from '../../kit/world/Camera.tsx';
import { cameraAt, shotOnDisplay, type Shot } from '../../kit/world/camera.ts';
import { FRAME_SCALE } from '../../kit/world/points.ts';
import { Mac } from './Mac.tsx';
import { MemoryPanel } from './MemoryPanel.tsx';
import { MEMORY, WHIP_IN } from './plan.ts';

/** The panel, 500 × 680 pt at the desktop's scale, centered on the close-up's world. */
const PANEL = { width: 500 * FRAME_SCALE, height: 680 * FRAME_SCALE };
const PANEL_BOX = { x: 960 - PANEL.width / 2, y: 540 - PANEL.height / 2 };
/**
 * The close-up rests on the panel's lower half, where the conversation grows above the composer;
 * its bottom edge floats over the light, leaving the lower band to the caption.
 */
const REST: Shot = { at: WHIP_IN, x: 960, y: 800, zoom: 1.5, spring: springs.snappy };
/** The whip arrives from above, as the desktop's camera left downward. */
const ARRIVE = 640;
const CREEP = { response: 3.2, damping: 1 };

const PANEL_SHOTS: readonly Shot[] = [
  { at: 0, x: REST.x, y: REST.y - ARRIVE, zoom: REST.zoom * 1.06 },
  REST,
  { at: MEMORY.typing[0], x: 972, y: 798, zoom: 1.6, spring: CREEP },
  { at: MEMORY.later, x: 966, y: 790, zoom: 1.56, spring: CREEP },
];

/** The dawn desktop far behind, defocused, moving less than the panel for parallax. */
const BACK = shotOnDisplay(WHIP_IN, { x: 1060, y: 420 }, 1.2, { spring: springs.snappy });
const BACK_SHOTS: readonly Shot[] = [
  { ...BACK, at: 0, y: BACK.y - ARRIVE * 0.12 },
  BACK,
  { ...BACK, at: MEMORY.typing[0], x: BACK.x + 12, zoom: 1.24, spring: CREEP },
];

/**
 * The memory close-up: the task panel lifted off the dawn desktop, which sits far behind it out of
 * focus. Both arrive inside the whip the cut hides in, the panel faster than the desktop.
 */
export function MemoryShot({ t, lang }: { t: number; lang: Lang }) {
  return (
    <>
      <Camera state={cameraAt(t, BACK_SHOTS)}>
        <Mac t={t} lang={lang} items={false} />
      </Camera>
      <div className="anytime-haze" />
      <Camera state={cameraAt(t, PANEL_SHOTS)}>
        <div
          className="anytime-panel"
          style={{ '--x': PANEL_BOX.x, '--y': PANEL_BOX.y, '--s': FRAME_SCALE }}
        >
          <MemoryPanel t={t} lang={lang} />
        </div>
      </Camera>
    </>
  );
}
