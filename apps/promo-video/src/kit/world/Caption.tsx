import { clamp01, easeIn, mix, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { langTag, textUnits } from './text-units.ts';
import './caption.css';

interface CaptionProps {
  /** Seconds on the scene's clock. */
  t: number;
  /** When the first word starts to rise. */
  in: number;
  /** When the caption starts to leave; it is gone 0.4 s later. */
  out: number;
  text: string;
  /** `en` or `zh`: Chinese sets by word groups, not spaces. */
  lang?: string;
}

/**
 * The narrative caption, over the frame (not the camera's world): lower-left at x = 120 with its
 * last line on the baseline y ≈ 960, 44px. Words rise 24px out of a 6px blur, one after another,
 * hold, and leave together with a slight lift at `out`. One on screen at a time.
 */
export function Caption({ t, in: start, out, text, lang = 'en' }: CaptionProps) {
  if (t < start - 0.05 || t > out + 0.5) return null;
  const units = textUnits(text, lang);
  const stagger = lang === 'zh' ? 0.045 : 0.055;
  return (
    <div className="caption" lang={langTag(lang)}>
      <p className="caption__text">
        {units.map((unit, index) => {
          const enter = springAt(t, start + index * stagger, springs.smooth);
          const leave = ramp(t, out + index * 0.012, 0.32, easeIn);
          return (
            <span key={index}>
              <span
                className="caption__word"
                style={{
                  '--o': clamp01(enter * 1.5) * (1 - leave),
                  '--y': `${mix(24, 0, enter) - leave * 10}px`,
                  '--blur': `${(1 - clamp01(enter)) * 6 + leave * 4}px`,
                }}
              >
                {unit.text}
              </span>
              {unit.space}
            </span>
          );
        })}
      </p>
    </div>
  );
}
