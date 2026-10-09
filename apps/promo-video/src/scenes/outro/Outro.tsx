import { useCurrentFrame } from 'remotion';
import { copy, htmlLang, type Lang } from '../../copy.ts';
import { DotField } from '../../dots/DotField.tsx';
import type { FieldState } from '../../dots/field.ts';
import { rasterize, type RasterSpec } from '../../dots/raster.ts';
import { useFontsReady } from '../../fonts.ts';
import { easeInOut, mix, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { FPS, HEIGHT, OUTRO, WIDTH } from '../../timeline.ts';
import { Keycaps } from '../../ui/Keycaps.tsx';
import { KineticText } from '../../ui/KineticText.tsx';
import './outro.css';

const SPEC: RasterSpec = {
  width: WIDTH,
  height: HEIGHT,
  pitch: 12,
  words: ['Atd'],
  box: { x: 560, y: 64, width: 800, height: 420 },
  fontFamily: "'Inter Variable'",
  fontWeight: 900,
};

/**
 * The address in dot figures. Doto draws the full stop as a five-dot cross that reads as a comma
 * or a plus at this size, so the stop is its one-dot middle dot, set down on the baseline.
 */
function DotAddress({ text }: { text: string }) {
  return (
    <span className="outro__url">
      {text.split('.').flatMap((part, index) =>
        index === 0
          ? [part]
          : [
              <span key={index} className="outro__stop">
                ·
              </span>,
              part,
            ],
      )}
    </span>
  );
}

function outroState(t: number): FieldState {
  return {
    time: t,
    boot: t,
    word: 0,
    shown: 3,
    typing: false,
    settle: t - 1.4,
    cursor: 'blink',
    dissolve: 0,
    field: 0.11,
    art: 0.92,
  };
}

/**
 * The call to action: the display powers on again with the name, and under it the invitation, the
 * shortcut being pressed, and where to get Atd. The film then fades out on the blinking cursor.
 */
export function Outro({ lang }: { lang: Lang }) {
  const t = useCurrentFrame() / FPS;
  const ready = useFontsReady();
  const text = copy[lang].outro;
  const button = springAt(t, OUTRO.button, springs.pop);
  const typedUrl = Math.floor(Math.max(0, t - OUTRO.button - 0.25) / 0.06);
  const fade = ramp(t, OUTRO.fade - OUTRO.start, OUTRO.end - OUTRO.fade, easeInOut);
  const [first, , last] = OUTRO.keys;

  return (
    <div className="scene outro" lang={htmlLang(lang)} style={{ '--o': 1 - fade }}>
      <DotField raster={ready ? rasterize(SPEC) : null} state={outroState(t)} />
      <div className="outro__content">
        <KineticText
          className="outro__title"
          t={t}
          text={text.title}
          lang={lang}
          at={OUTRO.title}
          stagger={0.07}
        />
        <div className="outro__keys">
          <Keycaps
            t={t}
            appearAt={first - 0.35}
            pressAt={OUTRO.keys}
            releaseAt={last + 0.4}
            size={58}
          />
        </div>
        <div className="outro__cta">
          <div
            className="outro__button"
            style={{
              '--o': Math.min(1, button * 2.4),
              '--s': mix(0.8, 1, button),
              '--glow': Math.min(1, button),
            }}
          >
            {text.cta}
            <div
              className="outro__shine"
              style={{ '--x': `${mix(-120, 120, ramp(t, 5.2, 1.1, easeInOut))}%` }}
            />
          </div>
          <DotAddress text={text.url.slice(0, typedUrl)} />
        </div>
        <div className="outro__specs" style={{ '--o': ramp(t, OUTRO.button + 0.8, 0.5) }}>
          {text.specs}
        </div>
      </div>
    </div>
  );
}
