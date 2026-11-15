import { useEffect, useRef } from 'react';
import { useDotField } from '../../gl/use-dot-field';
import type { DotFieldPalette } from '../../gl/types';
import { useCopy } from '../../i18n/lang';
import { useResolvedTheme } from '../../lib/theme';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { heroCopy } from './copy';
import './hero.css';

/** The field's pitch range: finer on compact widths, where the words are small. */
const PITCH = [6, 14] as const;

const DARK_PALETTE = {
  ink: [0, 0, 0],
  dot: [0.9883, 0.9883, 0.9883],
  fieldLevel: 0,
} as const satisfies DotFieldPalette;

const LIGHT_PALETTE = {
  ink: [1, 1, 1],
  dot: [0.0941, 0.0941, 0.1059],
  fieldLevel: 0,
} as const satisfies DotFieldPalette;

/**
 * The opening section: a rotating 3D ASCII sculpture backdrop paired with the WebGL dot-matrix
 * wordmark that cycles Atd → Anything → Anytime → Anywhere behind a blinking block cursor, plus
 * quiet registration marks and tagline. Without WebGL (`data-gl="off"`), the static Doto
 * wordmark stands in cleanly over the backdrop.
 */
export function HeroSection() {
  const t = useCopy(heroCopy);
  const reducedMotion = useReducedMotion();
  const theme = useResolvedTheme();
  const palette = theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const asciiRef = useRef<HTMLDivElement>(null);

  useDotField(
    { canvas: canvasRef, root: sectionRef, art: markRef },
    { words: t.words, reducedMotion, pitch: PITCH, ...palette },
  );

  useEffect(() => {
    const container = asciiRef.current;
    if (!container) return;

    let disposeEngine: (() => void) | undefined;
    let cancelled = false;

    void import('./hero-ascii-engine').then(({ mountHeroAsciiEngine }) => {
      if (cancelled || !asciiRef.current) return;
      disposeEngine = mountHeroAsciiEngine(asciiRef.current, {
        reduceMotion: reducedMotion,
      });
    });

    return () => {
      cancelled = true;
      disposeEngine?.();
    };
  }, [reducedMotion]);

  return (
    <section ref={sectionRef} id="top" className="hero" aria-labelledby="hero-title">
      <div ref={asciiRef} className="hero__ascii" aria-hidden="true" />
      <div className="hero__vignette" aria-hidden="true" />
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
