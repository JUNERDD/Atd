import type { Lang } from '../../copy.ts';
import { ramp } from '../../motion/ease.ts';
import { springs } from '../../motion/spring.ts';
import { CHAPTER_TITLE } from '../../timeline.ts';
import { Camera } from '../../kit/world/Camera.tsx';
import { cameraAt, REST_SHOT, shotOnDisplay, type Shot } from '../../kit/world/camera.ts';
import { Mac } from './Mac.tsx';
import { FOLDER_ART, LAPSE, NOTICE_X, WHIP_OUT } from './plan.ts';

/** The flight through the chapter word: quick off the mark, settling without overshoot. */
const FLIGHT = { response: 0.9, damping: 1 };
/** The slow push of a time-lapse dolly through the night. */
const CREEP = { response: 3.4, damping: 1 };

/** Where the night is watched from: the folder and the clock in one frame, light to the left. */
const NIGHT = { x: FOLDER_ART.x, y: 230 };
/** At dawn the camera pushes toward the banners, the folder still in view below them. */
const MORNING = { x: NOTICE_X + 120, y: 190 };

const SHOTS: readonly Shot[] = [
  // Behind the word the desktop is out of focus; it sharpens as the camera flies through.
  { ...REST_SHOT, blur: 18 },
  shotOnDisplay(CHAPTER_TITLE.out, NIGHT, 1.55, { spring: FLIGHT }),
  shotOnDisplay(LAPSE.idle, NIGHT, 1.8, { spring: CREEP }),
  shotOnDisplay(LAPSE.dawn, MORNING, 2),
];

/** The whip down the screen that the cut to the panel happens inside. */
function whip(from: Shot): Shot {
  return {
    at: WHIP_OUT,
    x: from.x,
    y: from.y + 980,
    zoom: from.zoom * 1.12,
    spring: springs.snappy,
  };
}

const ALL_SHOTS = [...SHOTS, whip(SHOTS.at(-1) ?? REST_SHOT)];

/**
 * The desktop from dusk to dawn. It appears behind the chapter word as the camera flies through
 * it, the camera creeps in while the night races, pushes toward the results at dawn, and whips
 * down the screen into the cut.
 */
export function Timelapse({ t, lang }: { t: number; lang: Lang }) {
  const camera = cameraAt(t, ALL_SHOTS);
  const shown = ramp(t, CHAPTER_TITLE.out + 0.1, 0.4);
  if (shown <= 0) return null;
  return (
    <div className="anytime-world" style={{ '--o': shown }}>
      <Camera state={camera}>
        <Mac t={t} lang={lang} />
      </Camera>
    </div>
  );
}
