import type { Lang } from '../copy.ts';
import { easeIn, mix, ramp } from '../motion/ease.ts';
import { springAt, springs, type Spring } from '../motion/spring.ts';
import './kinetic.css';

/** However many pieces there are, the last starts to leave this long after the first. */
const LEAVE_SPREAD = 0.1;
/** How long each piece takes to leave. */
const LEAVE_LENGTH = 0.32;

interface Unit {
  text: string;
  /** Whitespace after the unit, kept outside it so lines can break there. */
  space: string;
}

/**
 * Splits text into the pieces that move: words for English, and Chinese words found by the
 * browser's segmenter. Punctuation stays with the word before it, so no line starts with it.
 */
function unitsOf(text: string, lang: Lang): Unit[] {
  const segmenter = new Intl.Segmenter(lang === 'zh' ? 'zh-CN' : 'en', { granularity: 'word' });
  const units: Unit[] = [];
  for (const { segment, isWordLike } of segmenter.segment(text)) {
    const last = units[units.length - 1];
    if (/^\s+$/u.test(segment)) {
      if (last) last.space += segment;
    } else if (!isWordLike && last && last.space === '') last.text += segment;
    else units.push({ text: segment, space: '' });
  }
  return units;
}

interface KineticTextProps {
  text: string;
  lang: Lang;
  /** The clock the text moves on, in seconds. */
  t: number;
  /** When the first piece starts to rise. */
  at: number;
  /** When the pieces start to leave, if they do; all are gone LEAVE_SPREAD + LEAVE_LENGTH later. */
  exitAt?: number;
  /** Seconds between pieces. */
  stagger?: number;
  /** How far each piece rises, in em. */
  rise?: number;
  spring?: Spring;
  /** Lights the lettering in dots, like the website's headings. */
  dotted?: boolean;
  /** The caller's class for the text's typography and placement. */
  className: string;
}

/**
 * Text that arrives piece by piece: each word rises into place out of a soft blur on a spring,
 * then leaves upward the same way, a little faster. A newline sets a line break.
 */
export function KineticText({
  text,
  lang,
  t,
  at,
  exitAt,
  stagger = lang === 'zh' ? 0.05 : 0.06,
  rise = 0.42,
  spring = springs.smooth,
  dotted = false,
  className,
}: KineticTextProps) {
  const lines = text.split('\n').map((line) => unitsOf(line, lang));
  const count = lines.reduce((sum, units) => sum + units.length, 0);
  // Long titles leave as quickly as short ones, so a caption is always gone when its scene ends.
  const leaveStep = Math.min(stagger * 0.5, LEAVE_SPREAD / Math.max(1, count - 1));
  let order = 0;

  return (
    <div className={className} data-dotted={dotted ? '' : undefined}>
      {lines.map((units, line) => (
        <div key={line}>
          {units.map((unit) => {
            const index = order++;
            const enter = springAt(t, at + index * stagger, spring);
            const leave =
              exitAt === undefined ? 0 : ramp(t, exitAt + index * leaveStep, LEAVE_LENGTH, easeIn);
            const blur = (1 - Math.min(1, enter)) * 12 + leave * 8;
            return (
              <span key={index}>
                <span
                  className="kinetic"
                  style={{
                    '--o': Math.min(1, enter) * (1 - leave),
                    '--rise': mix(rise, 0, enter) - leave * rise * 0.6,
                    '--filter': blur > 0.05 ? `blur(${blur}px)` : undefined,
                  }}
                >
                  {unit.text}
                </span>
                {unit.space}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
