import { clamp01, easeIn, mix, ramp, smoothstep } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { BEAT, CHAPTER_TITLE } from '../../timeline.ts';
import { textWidthEm } from './measure.ts';
import { graphemes, langTag, textUnits } from './text-units.ts';
import './chapter-title.css';

/** The word's set, as the spec gives it. */
const WEIGHT = 650;
const TRACKING = -0.045;
/** Letters land this far apart: a quick ripple that resolves on the downbeat's next sixteenth. */
const STAGGER = BEAT / 12;
/** How long the fly-through takes once it starts. */
const FLY = 0.55;

interface ChapterTitleProps {
  /** Seconds since the chapter's start; the word lands on 0 (the downbeat). */
  t: number;
  /** The chapter's word, e.g. "Anywhere." (English in both cuts). */
  word: string;
  subline: string;
  /** The subline's language (`en`, `zh`), for its segmentation and Chinese setting. */
  lang?: string;
  /** When the camera flies through the word; default `CHAPTER_TITLE.out`. */
  out?: number;
}

/**
 * A chapter's title card, filling its parent (the frame): the word at ≈260px in moving light, its
 * subline beneath. Letters rise out of a blur one after another from `t = 0`, the subline follows
 * on the next beat, and at `out` the word swells past the viewer, blurring and fading, while the
 * scene's world appears behind it. Transparent: place it over the scene.
 */
export function ChapterTitle({
  t,
  word,
  subline,
  lang = 'en',
  out = CHAPTER_TITLE.out,
}: ChapterTitleProps) {
  const letters = graphemes(word);
  const total = textWidthEm(word, WEIGHT, TRACKING);
  const fly = ramp(t, out, FLY, easeIn);
  const sublineUnits = textUnits(subline, lang);
  const offsets = letters.map((_, index) =>
    textWidthEm(letters.slice(0, index).join(''), WEIGHT, TRACKING),
  );

  return (
    <div
      className="chapter-title"
      style={{
        '--fly-scale': Math.exp(fly * 2.7),
        '--fly-blur': `${fly * 26}px`,
        '--fly-o': 1 - smoothstep(0.3, 1, fly),
        '--word-em': total,
        '--light-angle': `${100 + 14 * Math.sin(t * 0.9)}deg`,
        '--light-shift': 0.08 + t * 0.16,
      }}
    >
      <div className="chapter-title__word" aria-label={word}>
        {letters.map((letter, index) => {
          const enter = springAt(t, index * STAGGER, springs.smooth);
          const blur = (1 - clamp01(enter)) * 22;
          return (
            <span
              key={index}
              className="chapter-title__letter light-text"
              aria-hidden="true"
              style={{
                '--offset-em': offsets[index] ?? 0,
                '--o': clamp01(enter * 1.5),
                '--rise': mix(0.3, 0, enter),
                '--blur': `${blur}px`,
              }}
            >
              {letter}
            </span>
          );
        })}
      </div>
      <div
        className="chapter-title__subline"
        lang={langTag(lang)}
        style={{ '--leave': smoothstep(0, 0.45, fly) }}
      >
        {sublineUnits.map((unit, index) => {
          const enter = springAt(t, BEAT + index * 0.05, springs.smooth);
          return (
            <span key={index}>
              <span
                className="chapter-title__piece"
                style={{
                  '--o': clamp01(enter * 1.4),
                  '--rise': mix(0.5, 0, enter),
                  '--blur': `${(1 - clamp01(enter)) * 8}px`,
                }}
              >
                {unit.text}
              </span>
              {unit.space}
            </span>
          );
        })}
      </div>
    </div>
  );
}
