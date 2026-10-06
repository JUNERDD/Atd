import { useRef } from 'react';
import { useDotField } from '../../gl/use-dot-field';
import { useCopy } from '../../i18n/lang';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { DotGlyph } from '../../ui/dot-glyph';
import { heroCopy } from './copy';
import './hero.css';

/** The field's pitch range: finer on compact widths, where the words are small. */
const PITCH = [6, 14] as const;

/**
 * The scroll cue's mouse in dots: the body's outline, and down its middle the wheel's track (column
 * 3, rows 2–5), which hero.css steps a lit dot down.
 */
const MOUSE = [
  '..xxx..',
  '.x...x.',
  'x..x..x',
  'x..x..x',
  'x..x..x',
  'x..x..x',
  'x.....x',
  'x.....x',
  'x.....x',
  '.x...x.',
  '..xxx..',
];

/**
 * The opening section: a black LED panel (the WebGL dot field) whose display spells the name, then
 * what it stands for — anything, anytime, anywhere — each word melting into the next. The heading is
 * for assistive tech and search; the display is the visible title.
 *
 * The field powers on like a CRT and resolves the name out of static (see gl/shaders.ts), and the
 * registration marks come in on the same clock, then a dot-matrix mouse at the bottom center whose
 * wheel turns to say there is more below. For visitors who prefer reduced motion the display holds
 * the name and the wheel stays still. Without WebGL the Doto lettering and a CSS dot screen stand in
 * for the field (`data-gl="off"`).
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
      <span className="hero__scroll" aria-hidden="true" data-reveal="fade" data-reveal-delay="1700">
        <DotGlyph rows={MOUSE} />
      </span>
    </section>
  );
}
