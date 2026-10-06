import { Pause, Play } from 'lucide-react';
import { useRef, useState } from 'react';
import { useDotField } from '../../gl/use-dot-field';
import { useCopy } from '../../i18n/lang';
import { useHydrated } from '../../lib/use-hydrated';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { heroCopy } from './copy';
import { HeroLegend, ReadingValue } from './readouts';
import './hero.css';

/** The field's pitch range: finer on compact widths, where the words are small. */
const PITCH = [6, 14] as const;

/** `auto` animates unless the visitor prefers reduced motion; the toggle turns it `on` or `off`. */
type Motion = 'auto' | 'on' | 'off';

/**
 * The opening section: a black LED panel (the WebGL dot field) whose display spells the name, then
 * what it stands for — anything, anytime, anywhere — each word melting into the next. An
 * instrument strip runs along the bottom edge, its first readout the legend of the name. The
 * heading is for assistive tech and search; the display is the visible title.
 *
 * The field powers on like a CRT and resolves the name out of static (see gl/shaders.ts). The
 * registration marks and the strip come in on the same clock. The display's motion can be paused
 * from the strip, and it starts paused for visitors who prefer reduced motion. Without WebGL the
 * Doto lettering and a CSS dot screen stand in for the field (`data-gl="off"`).
 */
export function HeroSection() {
  const t = useCopy(heroCopy);
  const reducedMotion = useReducedMotion();
  const hydrated = useHydrated();
  const [motion, setMotion] = useState<Motion>('auto');
  const [word, setWord] = useState(0);
  const playing = motion === 'on' || (motion === 'auto' && !reducedMotion);
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLDivElement>(null);

  useDotField(
    { canvas: canvasRef, root: sectionRef, art: markRef },
    { words: t.words, reducedMotion: !playing, pitch: PITCH, onWord: setWord },
  );

  return (
    <section ref={sectionRef} id="top" className="hero" aria-labelledby="hero-title">
      <h1 id="hero-title" className="sr-only">
        {t.title}
      </h1>
      <canvas ref={canvasRef} className="hero__canvas" aria-hidden="true" />
      <div className="hero__stage">
        <span
          className="hero__reg"
          data-corner="start"
          aria-hidden="true"
          data-reveal="plot"
          data-reveal-delay="700"
        />
        <span
          className="hero__reg"
          data-corner="end"
          aria-hidden="true"
          data-reveal="plot"
          data-reveal-delay="780"
        />
        <div ref={markRef} className="hero__mark" aria-hidden="true">
          <span className="hero__mark-word">{t.words[0]}</span>
        </div>
      </div>
      <div className="hero__instrument container" data-reveal-group="" data-reveal-delay="1000">
        <span className="hero__rule" aria-hidden="true" data-reveal="draw" data-reveal-delay="0" />
        <dl className="hero__readout">
          <HeroLegend legend={t.legend} word={word} />
          {t.readings.map((reading, index) => (
            <div
              key={reading.label}
              className="hero__reading"
              data-reveal="rise"
              data-reveal-delay={250 + index * 90}
            >
              <dt className="mono-label">{reading.label}</dt>
              <ReadingValue reading={reading} delay={350 + index * 90} />
            </div>
          ))}
        </dl>
        <div className="hero__end">
          <button
            type="button"
            className="btn-plain btn-icon hero__motion"
            aria-label={t.motion}
            aria-pressed={playing}
            data-ready={hydrated ? '' : undefined}
            data-reveal="fade"
            data-reveal-delay="640"
            onClick={() => setMotion(playing ? 'off' : 'on')}
          >
            {playing ? (
              <Pause aria-hidden="true" fill="currentColor" />
            ) : (
              <Play aria-hidden="true" fill="currentColor" />
            )}
          </button>
          <span className="hero__cue" aria-hidden="true" data-reveal="fade" data-reveal-delay="720">
            <span className="hero__cue-track">
              <span className="hero__cue-dot" />
            </span>
            <span className="mono-label">{t.scroll}</span>
          </span>
        </div>
      </div>
    </section>
  );
}
