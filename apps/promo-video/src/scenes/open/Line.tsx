import { clamp01, easeIn, mix, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { langTag, textUnits } from '../../kit/world/text-units.ts';
import './line.css';

interface LineProps {
  /** Seconds on the scene's clock. */
  t: number;
  /** When the first word starts to rise. */
  in: number;
  /** When the line leaves (drops and blurs away); omit to hold. */
  out?: number;
  text: string;
  lang: string;
  /** `tagline`: the Open's quiet line under the lockup. `statement`: the finale's closing line. */
  variant: 'tagline' | 'statement';
}

/**
 * A centered line set word by word (Chinese by word groups): each piece rises out of a blur on
 * the `smooth` spring, a sixteenth apart, like the chapter sublines. It fills its parent's width
 * and centers itself; the parent places it.
 */
export function Line({ t, in: start, out, text, lang, variant }: LineProps) {
  if (t < start - 0.05) return null;
  const units = textUnits(text, lang);
  const stagger = lang === 'zh' ? 0.05 : 0.065;
  const leave = out === undefined ? 0 : ramp(t, out, 0.35, easeIn);
  if (leave >= 1) return null;
  return (
    <p className="line" data-variant={variant} lang={langTag(lang)}>
      {units.map((unit, index) => {
        const enter = springAt(t, start + index * stagger, springs.smooth);
        return (
          <span key={index}>
            <span
              className="line__word"
              style={{
                '--o': clamp01(enter * 1.5) * (1 - leave),
                '--y': `${mix(0.5, 0, enter) + leave * 0.6}em`,
                '--blur': `${(1 - clamp01(enter)) * 0.16 + leave * 0.25}em`,
              }}
            >
              {unit.text}
            </span>
            {unit.space}
          </span>
        );
      })}
    </p>
  );
}
