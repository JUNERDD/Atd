import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { copy, type Lang } from '../../copy.ts';
import { useFontsReady } from '../../fonts.ts';
import { Camera } from '../../kit/world/Camera.tsx';
import { cameraAt, type CameraState, type Shot } from '../../kit/world/camera.ts';
import { Keycaps } from '../../kit/world/Keycaps.tsx';
import { Light } from '../../kit/world/Light.tsx';
import { blendMoods } from '../../kit/world/light-field.ts';
import { Lockup } from '../../kit/world/Lockup.tsx';
import { easeInOut, mix, ramp, smoothstep } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { CHOREO, sectionLength } from '../../timeline.ts';
import { Line } from './Line.tsx';
import './open.css';

const BEATS = CHOREO.open;
const LENGTH = sectionLength('open');

/** World positions, in frame px of the camera's world: the keys low, the lockup above them. */
const KEYS = { x: 960, y: 860 };
const MARK = { x: 960, y: 330 };
/** Where the camera rests once it has tilted up from the keys to the mark. */
const REST = { x: 960, y: 405 };

/** The chord holds until every key is down, then releases together. */
const RELEASE = BEATS.keys[2] + 0.42;
/** The drops travel for 78% of the formation, so they touch exactly on `mark`. */
const FORMATION = (BEATS.mark - BEATS.drops) / 0.78;
/** The push through the lockup: it starts on `exit` and is through by the cut. */
const PUSH = LENGTH - BEATS.exit;

/** The push accelerates steadily (not the long, idle start of `easeIn`), so it reads from `exit`. */
const pushEase = (x: number) => x * x;

/** A slow creep for the macro push-in on the keys. */
const CREEP = { response: 2.8, damping: 1 };

const SHOTS: readonly Shot[] = [
  { at: 0, x: KEYS.x, y: KEYS.y - 40, zoom: 1.2 },
  { at: 0.2, x: KEYS.x, y: KEYS.y - 20, zoom: 1.32, spring: CREEP },
  // The light blooms from under Space and the camera tilts up after it, arriving as the drops lock.
  { at: BEATS.bloom + 0.1, x: REST.x, y: REST.y - 10, zoom: 1, rotateX: 0 },
  { at: BEATS.wordmark, x: REST.x, y: REST.y, zoom: 1.04, spring: CREEP },
];

/**
 * The camera over the whole section: the keys macro, the tilt up into the mark, then on `exit` a
 * push that accelerates through the gap between mark and word, past the viewer, by the cut.
 */
function cameraOf(t: number): CameraState {
  const base = cameraAt(t, SHOTS);
  const push = ramp(t, BEATS.exit, PUSH, pushEase);
  if (push <= 0) return base;
  const rate = (ramp(t + 1 / 240, BEATS.exit, PUSH, pushEase) - push) * 240;
  const zoom = base.zoom * Math.exp(push * 2.9);
  const aim = smoothstep(0, 0.6, push);
  return {
    ...base,
    x: mix(base.x, MARK.x, aim),
    y: mix(base.y, MARK.y, aim),
    zoom,
    vzoom: zoom * 2.9 * rate,
  };
}

/** The Open: the shortcut pressed, light from under Space, the mark forming from it, the name. */
export function Open({ lang }: { lang: Lang }) {
  useFontsReady();
  const t = useCurrentFrame() / useVideoConfig().fps;
  const camera = cameraOf(t);

  const bloom = ramp(t, BEATS.bloom, 0.5);
  const push = ramp(t, BEATS.exit, PUSH, pushEase);
  // Near black until Space; the light comes up with the bloom, and fills in as we push through.
  const intensity =
    0.05 + 0.5 * ramp(t, BEATS.bloom, 1.6) + 0.45 * ramp(t, BEATS.exit, PUSH, easeInOut);
  // The keys go soft as focus racks up to the mark.
  const rack = ramp(t, BEATS.drops, 1.1);

  return (
    <AbsoluteFill className="scene open" lang={lang}>
      <Light
        t={t - LENGTH}
        mood={blendMoods('dusk', 'night', ramp(t, BEATS.bloom + 0.5, 4, easeInOut))}
        intensity={intensity}
      />
      <Camera state={camera}>
        <div
          className="open__bloom"
          style={{
            '--x': KEYS.x + 244,
            '--y': KEYS.y,
            '--s': mix(0.25, 1, ramp(t, BEATS.bloom, 1.6)),
            '--o': bloom * (1 - 0.55 * ramp(t, BEATS.mark, 2)) * (1 - push),
          }}
        />
        <div
          className="open__keys"
          style={{
            '--x': KEYS.x,
            '--y': KEYS.y,
            '--rack': `${rack * 9}px`,
            '--o': 1 - rack * 0.55,
          }}
        >
          <Keycaps
            t={t}
            size={210}
            appearAt={0.25}
            dof={0.45}
            focus={2}
            keys={[
              { legend: '⌘', press: BEATS.keys[0], release: RELEASE },
              { legend: '⇧', press: BEATS.keys[1], release: RELEASE },
              {
                legend: 'Space',
                press: BEATS.keys[2],
                release: RELEASE,
                glow: bloom * (1 - 0.6 * ramp(t, BEATS.mark, 1.5)),
              },
            ]}
          />
        </div>
        <div
          className="open__mark"
          style={{ '--x': MARK.x, '--y': MARK.y, '--o': 1 - smoothstep(0.55, 0.95, push) }}
        >
          <Lockup
            size={210}
            formation={ramp(t, BEATS.drops, FORMATION, (x) => x)}
            settle={ramp(t, BEATS.mark + 0.25, 0.7)}
            glow={0.6}
            reveal={springAt(t, BEATS.wordmark, springs.smooth)}
          />
        </div>
        <div className="open__tagline" style={{ '--x': MARK.x, '--y': MARK.y + 205 }}>
          <Line
            t={t}
            in={BEATS.tagline}
            out={BEATS.exit}
            text={copy[lang].tagline}
            lang={lang}
            variant="tagline"
          />
        </div>
      </Camera>
    </AbsoluteFill>
  );
}
