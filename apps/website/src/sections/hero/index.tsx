import { useRef } from 'react';
import { useDotField } from '../../gl/use-dot-field';
import { useCopy } from '../../i18n/lang';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { heroCopy } from './copy';
import './hero.css';

/** The field's pitch range: finer on compact widths, where the words are small. */
const PITCH = [6, 14] as const;

/**
 * The opening section: a black LED panel (the WebGL dot field) whose display spells the name, then
 * what it stands for — anything, anytime, anywhere — each word erased and the next typed in behind a
 * block cursor that blinks while a word rests. A quiet subtitle below identifies the product.
 *
 * The field wakes outward from the name as a soft wave and the name lights up behind it, left to
 * right (see gl/shaders.ts); the registration marks come in on the same clock. For visitors who
 * prefer reduced motion the display holds the name with a steady cursor. Without WebGL the Doto
 * lettering and a CSS dot screen stand in for the field (`data-gl="off"`).
 */
export function HeroSection() {
  const t = useCopy(heroCopy);
  const reducedMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLDivElement>(null);

  useDotField(
    { canvas: canvasRef, root: sectionRef, art: markRef },
    { words: t.words, reducedMotion, pitch: PITCH },
  );

  return (
    <section ref={sectionRef} id="top" className="hero" aria-labelledby="hero-title">
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
        <h1 id="hero-title" className="hero__title" data-reveal="fade" data-reveal-delay="280">
          {t.title}
        </h1>
      </div>
    </section>
  );
}
