import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { copy, type Lang } from '../../copy.ts';
import { useFontsReady } from '../../fonts.ts';
import { Camera } from '../../kit/world/Camera.tsx';
import { cameraAt, type CameraState } from '../../kit/world/camera.ts';
import { Caption } from '../../kit/world/Caption.tsx';
import { DropsMark } from '../../kit/world/DropsMark.tsx';
import { Light } from '../../kit/world/Light.tsx';
import { mix, ramp } from '../../motion/ease.ts';
import { CHOREO, SECTIONS } from '../../timeline.ts';
import { CLOUD, LOCAL } from './brands.ts';
import { Orbit, type Ring } from './Orbit.tsx';
import {
  HANDOFF_INTENSITY,
  HANDOFF_MOOD,
  LIGHT_PARALLAX,
  LIGHT_X,
  lightCamera,
  WHIP_DISTANCE,
  whipOut,
} from './handoff.ts';
import './yours.css';

const BEATS = CHOREO.yours;

/** The system's center, a little above the frame's so the caption has the lower-left. */
const CENTER = { cx: 960, cy: 470 };
const OUTER: Ring = { ...CENTER, rx: 720, ry: 205, speed: 0.16, phase: 0.5, size: 104 };
const INNER: Ring = { ...CENTER, rx: 380, ry: 112, speed: -0.26, phase: 1.1, size: 96 };

const SLOW = { response: 4, damping: 1 };

/** The main camera: a slow push on the system, then the whip out on `exit`. */
function cameraOf(t: number): CameraState {
  const base = cameraAt(t, [
    { at: 0, x: 960, y: 530, zoom: 0.95, rotateX: 9 },
    { at: 0, x: 960, y: 500, zoom: 1.06, rotateX: 3, spring: SLOW },
  ]);
  const whip = whipOut(t, BEATS.exit);
  return { ...base, x: base.x + whip.x, vx: base.vx + whip.vx };
}

/**
 * Yours: the Drops mark at the center of the light, the models it can use orbiting it on two
 * rings, the cloud's providers outside and the servers that run models on the Mac inside. The
 * local ring lights, the promise lands, and the camera whips on into the finale.
 */
export function Yours({ lang }: { lang: Lang }) {
  useFontsReady();
  const t = useCurrentFrame() / useVideoConfig().fps;
  const whip = whipOut(t, BEATS.exit, WHIP_DISTANCE * LIGHT_PARALLAX);
  const lit = ramp(t, BEATS.local, 0.5);
  const ripple = ramp(t, BEATS.local, 0.9);
  const orbit = { t, enter: BEATS.marks } as const;
  const local = { ...orbit, ring: INNER, brands: LOCAL, lit, litAt: BEATS.local } as const;
  const cloud = { ...orbit, ring: OUTER, brands: CLOUD } as const;

  return (
    <AbsoluteFill className="scene yours" lang={lang}>
      <Camera state={lightCamera(LIGHT_X + whip.x, whip.vx)}>
        <Light t={SECTIONS.yours.start + t} mood={HANDOFF_MOOD} intensity={HANDOFF_INTENSITY} />
      </Camera>
      <Camera state={cameraOf(t)}>
        <Orbit {...cloud} layer="back" />
        <Orbit {...local} layer="back" />
        <div
          className="yours__ripple"
          style={{
            '--x': CENTER.cx,
            '--y': CENTER.cy,
            '--rx': INNER.rx,
            '--ry': INNER.ry,
            '--s': mix(1, 1.9, ripple),
            '--o': ripple > 0 && ripple < 1 ? (1 - ripple) * 0.9 : 0,
          }}
        />
        <div className="yours__mark" style={{ '--x': CENTER.cx, '--y': CENTER.cy }}>
          <DropsMark formation={1} settle={1} glow={0.55 + 0.35 * lit} size={150} />
        </div>
        <Orbit {...local} layer="front" />
        <Orbit {...cloud} layer="front" />
      </Camera>
      <Caption
        t={t}
        in={BEATS.marks + 0.05}
        out={BEATS.promise - 0.5}
        text={copy[lang].yours.models}
        lang={lang}
      />
      <Caption
        t={t}
        in={BEATS.promise}
        out={BEATS.exit - 0.15}
        text={copy[lang].yours.promise}
        lang={lang}
      />
    </AbsoluteFill>
  );
}
