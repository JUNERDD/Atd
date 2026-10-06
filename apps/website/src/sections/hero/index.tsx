import { Mouse, Pause, Play } from 'lucide-react';
import { useRef, useState } from 'react';
import { useDotField } from '../../gl/use-dot-field';
import { useCopy } from '../../i18n/lang';
import { useHydrated } from '../../lib/use-hydrated';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { heroCopy } from './copy';
import './hero.css';

/** The field's pitch range: finer on compact widths, where the words are small. */
const PITCH = [6, 14] as const;

/** `auto` animates unless the visitor prefers reduced motion; the toggle turns it `on` or `off`. */
type Motion = 'auto' | 'on' | 'off';

/**
 * The opening section: a black LED panel (the WebGL dot field) whose display spells the name, then
 * what it stands for — anything, anytime, anywhere — each word melting into the next. The heading is
 * for assistive tech and search; the display is the visible title.
 *
 * The field powers on like a CRT and resolves the name out of static (see gl/shaders.ts), and the
 * registration marks come in on the same clock, then a mouse at the bottom center whose wheel rolls
 * to say there is more below. A button in the corner pauses the display's motion and the wheel's;
 * both start paused for visitors who prefer reduced motion. Without WebGL the Doto lettering and a
 * CSS dot screen stand in for the field (`data-gl="off"`).
 */
export function HeroSection() {
  const t = useCopy(heroCopy);
  const reducedMotion = useReducedMotion();
  const hydrated = useHydrated();
  const [motion, setMotion] = useState<Motion>('auto');
  const playing = motion === 'on' || (motion === 'auto' && !reducedMotion);
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLDivElement>(null);

  useDotField(
    { canvas: canvasRef, root: sectionRef, art: markRef },
    { words: t.words, reducedMotion: !playing, pitch: PITCH },
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
      <span
        className="hero__scroll"
        aria-hidden="true"
        data-playing={playing ? '' : undefined}
        data-reveal="fade"
        data-reveal-delay="1700"
      >
        <Mouse size={36} absoluteStrokeWidth strokeWidth={1} />
      </span>
      <button
        type="button"
        className="btn-plain btn-icon hero__motion"
        aria-label={t.motion}
        aria-pressed={playing}
        data-ready={hydrated ? '' : undefined}
        data-reveal="fade"
        data-reveal-delay="1600"
        onClick={() => setMotion(playing ? 'off' : 'on')}
      >
        {playing ? (
          <Pause aria-hidden="true" fill="currentColor" />
        ) : (
          <Play aria-hidden="true" fill="currentColor" />
        )}
      </button>
    </section>
  );
}
