import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { copy, type Lang } from '../../copy.ts';
import { useFontsReady } from '../../fonts.ts';
import { Camera } from '../../kit/world/Camera.tsx';
import { cameraAt, type CameraState } from '../../kit/world/camera.ts';
import { Keycaps } from '../../kit/world/Keycaps.tsx';
import { Light } from '../../kit/world/Light.tsx';
import type { MoodWeights } from '../../kit/world/light-field.ts';
import { Lockup } from '../../kit/world/Lockup.tsx';
import { langTag } from '../../kit/world/text-units.ts';
import { clamp01, easeInOut, mix, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { CHOREO, SECTIONS, sectionLength } from '../../timeline.ts';
import { Line } from '../open/Line.tsx';
import {
  HANDOFF_INTENSITY,
  HANDOFF_MOOD,
  LIGHT_PARALLAX,
  LIGHT_X,
  lightCamera,
  WHIP_DISTANCE,
  whipIn,
} from '../yours/handoff.ts';
import { Cta } from './Cta.tsx';
import './finale.css';

const BEATS = CHOREO.finale;
const LENGTH = sectionLength('finale');

/** World positions (frame px at rest): the keys low, then the sign-off stacked on the center. */
const KEYS = { x: 960, y: 770 };
const MARK = { x: 960, y: 330 };
const LINE_Y = 515;
const CTA_Y = 648;
const URL_Y = 752;
const SPECS_Y = 806;

const RELEASE = BEATS.keys[2] + 0.16;
/** The drops travel for 78% of the formation, so they touch on `mark`. */
const FORMATION = (BEATS.mark - BEATS.drops) / 0.78;
const CREEP = { response: 5, damping: 1 };

/** The camera lands from the whip on the keys, tilts up with the drops, then barely breathes in. */
function cameraOf(t: number): CameraState {
  const base = cameraAt(t, [
    { at: 0, x: 960, y: 700, zoom: 1.12 },
    { at: BEATS.drops - 0.1, x: 960, y: 548, zoom: 1, spring: springs.window },
    { at: BEATS.specs, x: 960, y: 548, zoom: 1.03, spring: CREEP },
  ]);
  const whip = whipIn(t);
  return { ...base, x: base.x + whip.x, vx: base.vx + whip.vx };
}

/**
 * The Finale: the shortcut again, quicker; the mark re-forms from the last key's light, the name,
 * the closing line, a white key to download, the address and the specs. The picture fades out
 * under the last chord.
 */
export function Finale({ lang }: { lang: Lang }) {
  useFontsReady();
  const t = useCurrentFrame() / useVideoConfig().fps;
  const lines = copy[lang].finale;
  const light = whipIn(t, WHIP_DISTANCE * LIGHT_PARALLAX);
  const shift = WHIP_DISTANCE * LIGHT_PARALLAX;
  const bloom = ramp(t, BEATS.keys[2], 0.3) * (1 - ramp(t, BEATS.mark, 0.9));
  const away = ramp(t, BEATS.drops + 0.1, 0.7, easeInOut);
  const fade = ramp(t, BEATS.fade, LENGTH - BEATS.fade - 1 / 60, easeInOut);

  return (
    <AbsoluteFill className="scene finale" lang={lang}>
      <Camera state={lightCamera(LIGHT_X + shift * 2 + light.x, light.vx)}>
        <Light
          t={SECTIONS.finale.start + t}
          mood={settleMood(ramp(t, BEATS.mark, 2.5, easeInOut))}
          intensity={HANDOFF_INTENSITY - 0.25 * ramp(t, 0.2, 0.8) + 0.15 * ramp(t, BEATS.mark, 1.5)}
        />
      </Camera>
      <Camera state={cameraOf(t)}>
        <div
          className="finale__bloom"
          style={{ '--x': KEYS.x + 174, '--y': KEYS.y, '--o': bloom, '--s': mix(0.3, 1, bloom) }}
        />
        <div
          className="finale__keys"
          style={{
            '--x': KEYS.x,
            '--y': KEYS.y + away * 140,
            '--o': 1 - away,
            '--blur': `${away * 14}px`,
          }}
        >
          <Keycaps
            t={t}
            size={150}
            appearAt={0.02}
            dof={0.3}
            focus={2}
            keys={[
              { legend: '⌘', press: BEATS.keys[0], release: RELEASE },
              { legend: '⇧', press: BEATS.keys[1], release: RELEASE },
              { legend: 'Space', press: BEATS.keys[2], release: RELEASE, glow: bloom },
            ]}
          />
        </div>
        <div className="finale__anchor" style={{ '--x': MARK.x, '--y': MARK.y }}>
          <Lockup
            size={150}
            reach={2.6}
            formation={ramp(t, BEATS.drops, FORMATION, (x) => x)}
            settle={ramp(t, BEATS.mark + 0.1, 0.45)}
            glow={0.5}
            reveal={springAt(t, BEATS.wordmark, springs.smooth)}
          />
        </div>
        <div className="finale__row" style={{ '--y': LINE_Y }}>
          <Line t={t} in={BEATS.line} text={lines.line} lang={lang} variant="statement" />
        </div>
        <div className="finale__row" style={{ '--y': CTA_Y }}>
          <Cta t={t} at={BEATS.cta} label={lines.cta} />
        </div>
        <Rise t={t} at={BEATS.url} y={URL_Y} kind="url" lang={lang} text={lines.url} />
        <Rise t={t} at={BEATS.specs} y={SPECS_Y} kind="specs" lang={lang} text={lines.specs} />
      </Camera>
      <div className="finale__fade" style={{ '--o': fade }} />
    </AbsoluteFill>
  );
}

/** The hand-off's light, settling into plain night behind the sign-off. */
function settleMood(p: number): MoodWeights {
  const night = HANDOFF_MOOD.night ?? 0;
  const dawn = HANDOFF_MOOD.dawn ?? 0;
  return { night: mix(night, 1, p), dawn: mix(dawn, 0, p) };
}

interface RiseProps {
  t: number;
  at: number;
  /** The row's center, in world px. */
  y: number;
  kind: 'url' | 'specs';
  lang: Lang;
  text: string;
}

/** A small centered line that rises into place out of a blur on `at`. */
function Rise({ t, at, y, kind, lang, text }: RiseProps) {
  const p = springAt(t, at, springs.smooth);
  return (
    <div
      className="finale__row finale__small"
      data-kind={kind}
      lang={langTag(lang)}
      style={{
        '--y': y,
        '--o': clamp01(p * 1.6),
        '--rise': `${mix(18, 0, p)}px`,
        '--blur': `${(1 - clamp01(p)) * 6}px`,
      }}
    >
      {text}
    </div>
  );
}
