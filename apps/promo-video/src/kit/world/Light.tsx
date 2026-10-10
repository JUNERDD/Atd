import { hash01 } from '../../motion/ease.ts';
import {
  BLOBS,
  MOODS,
  normalizeMood,
  type BlobDesign,
  type Mood,
  type MoodWeights,
} from './light-field.ts';
import './light.css';

interface LightProps {
  /** Seconds on any steady clock (section-local is fine); the blobs drift on it, never loop. */
  t: number;
  /** A mood, or a blend of moods by weight (see `blendMoods`, `timelapseMood`). Default `bright`. */
  mood?: Mood | MoodWeights;
  /** Scales every light's brightness: 0 is the bare night ink, 1 the designed level. */
  intensity?: number;
  /** Film grain strength, 0–1 (default 0.5). Pass 0 when a grain already lies over this light. */
  grain?: number;
  /** How much the edges fall off into the ink, 0–1 (default 0.55). */
  vignette?: number;
}

interface BlobFrame {
  x: number;
  y: number;
  scale: number;
  /** The ellipse's tilt, in degrees, so no two lights share an outline. */
  rotate: number;
  alpha: number;
  /** Sequential color-mix weights: dusk into night, then dawn, then bright. */
  mixes: [number, number, number];
}

/** One blob's place, size and mood-blended look at time `t`. */
function blobAt(blob: BlobDesign, t: number, weights: Record<Mood, number>): BlobFrame {
  const w = (2 * Math.PI) / blob.drift.period;
  const x = blob.x + blob.drift.x * Math.sin(w * t + blob.phase) + 1.5 * Math.sin(2.3 * w * t);
  const y =
    blob.y + blob.drift.y * Math.cos(0.8 * w * t + blob.phase * 1.7) + 1.2 * Math.cos(1.9 * w * t);
  let alpha = 0;
  let dy = 0;
  // A mood in which this blob is dark should not tint it, so colors blend by weight × alpha.
  const tint = MOODS.map((mood) => weights[mood] * blob.looks[mood].alpha);
  for (const mood of MOODS) {
    alpha += weights[mood] * blob.looks[mood].alpha;
    dy += weights[mood] * (blob.looks[mood].dy ?? 0);
  }
  const share = (index: number) => {
    const upTo = tint.slice(0, index + 1).reduce((sum, value) => sum + value, 0);
    return upTo > 0 ? (tint[index] ?? 0) / upTo : 0;
  };
  return {
    x,
    y: y + dy,
    scale: 1 + 0.07 * Math.sin(0.6 * w * t + blob.phase * 2.3),
    rotate: blob.phase * 37 + 6 * Math.sin(0.5 * w * t),
    alpha,
    mixes: [share(1), share(2), share(3)],
  };
}

/**
 * The film's world: soft fields of the onboarding light drifting over the night ink, with a
 * deterministic film grain and a vignette. It fills its parent, so the same component is the
 * full-frame backdrop and, inside `Desktop`, the Mac's wallpaper. A pure function of `t`.
 */
export function Light({
  t,
  mood = 'bright',
  intensity = 1,
  grain = 0.5,
  vignette = 0.55,
}: LightProps) {
  const weights = normalizeMood(mood);
  // The grain re-seeds 30 times a second, like film, at a position hashed from that tick.
  const tick = Math.floor(t * 30);
  return (
    <div className="light">
      <div className="light__field">
        {BLOBS.map((blob, index) => {
          const frame = blobAt(blob, t, weights);
          return (
            <div
              key={index}
              className="light__blob"
              style={{
                '--bx': frame.x,
                '--by': frame.y,
                '--size': blob.size,
                '--scale': frame.scale,
                '--rotate': `${frame.rotate}deg`,
                '--a': Math.min(1, frame.alpha * intensity),
                '--c-night': `var(--light-${blob.looks.night.color})`,
                '--c-dusk': `var(--light-${blob.looks.dusk.color})`,
                '--c-dawn': `var(--light-${blob.looks.dawn.color})`,
                '--c-bright': `var(--light-${blob.looks.bright.color})`,
                '--k1': frame.mixes[0],
                '--k2': frame.mixes[1],
                '--k3': frame.mixes[2],
              }}
            />
          );
        })}
      </div>
      <div className="light__vignette" style={{ '--vignette': vignette }} />
      {grain > 0 ? (
        <div
          className="light__grain"
          style={{
            '--grain': grain,
            '--gx': `${Math.round(hash01(tick * 2 + 1) * 256)}px`,
            '--gy': `${Math.round(hash01(tick * 2 + 2) * 256)}px`,
          }}
        />
      ) : null}
    </div>
  );
}
