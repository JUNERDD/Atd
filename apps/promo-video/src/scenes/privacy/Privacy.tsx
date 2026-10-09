import { useCurrentFrame } from 'remotion';
import { copy, htmlLang, type Lang } from '../../copy.ts';
import { useFontsReady } from '../../fonts.ts';
import { clamp01, easeIn, easeOut, mix, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { FPS, PRIVACY } from '../../timeline.ts';
import { KineticText } from '../../ui/KineticText.tsx';
import './privacy.css';

const LENGTH = PRIVACY.end - PRIVACY.start;
/** The ring's center and size, in frame pixels; privacy.css turns it about the same center. */
const RING = { cx: 960, cy: 486, radius: 392, dots: 132 };

/**
 * The dotted boundary of the Mac, as on the website's privacy board: its dots light around the
 * circle like a loader, then it turns slowly while a scanning arc brightens the dots it passes.
 */
function Ring({ t }: { t: number }) {
  return (
    <svg className="privacy__ring" width={1920} height={1080} style={{ '--turn': `${t * 6}deg` }}>
      {Array.from({ length: RING.dots }, (_, index) => {
        const share = index / RING.dots;
        const angle = share * Math.PI * 2 - Math.PI / 2;
        const lit = clamp01((t - PRIVACY.ring - share * 0.75) / 0.12);
        const scan = Math.max(0, Math.cos(angle - t * 2.4)) ** 14;
        return (
          <circle
            key={index}
            cx={RING.cx + Math.cos(angle) * RING.radius}
            cy={RING.cy + Math.sin(angle) * RING.radius}
            r={mix(1.6, 3.4, lit) + scan * 1.2}
            fill="currentColor"
            fillOpacity={mix(0.08, 0.5, lit) + scan * 0.5 * lit}
          />
        );
      })}
    </svg>
  );
}

/** A small cross drawn in dots. */
function Cross() {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18">
      {[0, 1, 2, 3, 4].flatMap((i) => [
        <circle key={`a${i}`} cx={1.8 + i * 3.6} cy={1.8 + i * 3.6} r={1.5} fill="currentColor" />,
        <circle key={`b${i}`} cx={16.2 - i * 3.6} cy={1.8 + i * 3.6} r={1.5} fill="currentColor" />,
      ])}
    </svg>
  );
}

/** Local by design: what Atd keeps stays inside the Mac's boundary, and three things it never has. */
export function Privacy({ lang }: { lang: Lang }) {
  const t = useCurrentFrame() / FPS;
  useFontsReady();
  const text = copy[lang].privacy;
  const out = ramp(t, LENGTH - 0.42, 0.4, easeIn);

  return (
    <div
      className="scene privacy"
      lang={htmlLang(lang)}
      style={{
        '--o': ramp(t, 0, 0.5, easeOut) * (1 - out),
        '--filter': out > 0 ? `blur(${out * 10}px)` : undefined,
      }}
    >
      <Ring t={t} />
      <div className="privacy__center">
        <KineticText
          className="privacy__title"
          t={t}
          text={text.title}
          lang={lang}
          at={PRIVACY.ring + 0.08}
          dotted
        />
        <KineticText
          className="privacy__lede"
          t={t}
          text={text.lede}
          lang={lang}
          at={PRIVACY.ring + 0.42}
          stagger={lang === 'zh' ? 0.03 : 0.022}
          rise={0.5}
        />
      </div>
      <div className="privacy__nevers">
        {text.never.map((label, index) => {
          const p = springAt(t, PRIVACY.nevers[index] ?? 0, springs.pop);
          return (
            <div
              key={label}
              className="never"
              style={{
                '--o': Math.min(1, p * 2.5),
                '--y': `${mix(20, 0, p)}px`,
                '--s': mix(0.86, 1, p),
              }}
            >
              <Cross />
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
