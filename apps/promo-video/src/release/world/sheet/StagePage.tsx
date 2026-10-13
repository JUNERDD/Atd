import { Camera } from '../../../kit/world/Camera.tsx';
import { cameraAt, REST_SHOT, shotOnDisplay } from '../../../kit/world/camera.ts';
import { MAC_CHROME } from '../../../kit/world/chrome.ts';
import { MacWindow } from '../../../kit/world/MacWindow.tsx';
import { centerOf } from '../../../kit/world/points.ts';
import { Stage } from '../Stage.tsx';
import { TypeLine } from '../TypeLine.tsx';
import { STAGE_PAGE } from './beats.ts';
import { content } from './content.ts';

const NOTE = { x: 420, y: 250, width: 672, height: 360 };
const ISLAND = { x: 756, y: 820 };

/**
 * The stage page: the graphite display with its glows and menu bar, a window whose glass reads
 * against them, the camera pushing in, and pulses rippling through the wallpaper's dots from a
 * click and from where the island would land.
 */
export function StagePage({ t }: { t: number }) {
  const en = content.en;
  const camera = cameraAt(t, [REST_SHOT, shotOnDisplay(STAGE_PAGE.push, centerOf(NOTE), 1.45)]);
  return (
    <>
      <Camera state={camera}>
        <Stage
          lang="en"
          t={t}
          appName={en.note}
          menus={MAC_CHROME.en.menus.app}
          pulses={[
            {
              x: NOTE.x + 120,
              y: NOTE.y + 130,
              at: STAGE_PAGE.click,
              strength: 0.9,
              tint: 'coral',
            },
            { x: ISLAND.x, y: ISLAND.y, at: STAGE_PAGE.land, strength: 1.1 },
          ]}
        >
          <MacWindow box={NOTE} title={en.note} material="glass">
            <div className="r08-sheet__note">
              <TypeLine
                t={t}
                lang="en"
                text={en.noteLine}
                at={STAGE_PAGE.type}
                pace="shipped"
                size="small"
                weight="text"
              />
            </div>
          </MacWindow>
        </Stage>
      </Camera>
      <div className="r08-sheet__label">{en.labels.stage}</div>
    </>
  );
}
