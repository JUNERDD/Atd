import { useEffect, useRef, useState } from 'react';
import { useResolvedTheme } from '../../lib/theme';
import { useInView } from '../../lib/use-in-view';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import type { FooterGlow as GlowRunner } from './glow-runner';
import './footer-glow.css';

/**
 * The footer's afterglow (`glow-field.ts`): the app panel's flowing light rising from the page's
 * bottom edge behind the footer, lit through the plate's LED holes. It is decoration only, absent
 * from the prerendered page and without script or WebGL2. Its runner loads once the footer is
 * within a screen of the viewport. The light powers on from the bottom edge up once a quarter of
 * the band is in view: the reader is still arriving, so the front climbs into view as the page
 * scrolls to its end instead of waiting for the last pixels.
 */
export function FooterGlow() {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const near = useInView(ref, { rootMargin: '100% 0px', once: true });
  const seen = useInView(ref, { threshold: 0.25, once: true });
  const reducedMotion = useReducedMotion();
  const theme = useResolvedTheme();
  const [glow, setGlow] = useState<GlowRunner | null>(null);
  const latest = useRef({ reducedMotion, theme });

  useEffect(() => {
    latest.current = { reducedMotion, theme };
  });

  useEffect(() => {
    if (!near) return undefined;
    let cancelled = false;
    let runner: GlowRunner | null = null;
    void import('./glow-runner').then(({ createFooterGlow }) => {
      const host = ref.current;
      const canvas = canvasRef.current;
      if (cancelled || !host || !canvas) return;
      runner = createFooterGlow(canvas, {
        ...latest.current,
        onLive: (live) => host.toggleAttribute('data-live', live),
      });
      setGlow(runner);
    });
    return () => {
      cancelled = true;
      runner?.destroy();
      setGlow(null);
    };
  }, [near]);

  useEffect(() => {
    glow?.setTheme(theme);
  }, [glow, theme]);
  useEffect(() => {
    glow?.setReducedMotion(reducedMotion);
  }, [glow, reducedMotion]);
  useEffect(() => {
    if (seen) glow?.ignite();
  }, [glow, seen]);

  return (
    <div ref={ref} className="footer__glow" aria-hidden="true">
      <canvas ref={canvasRef} className="footer__glow-field" />
    </div>
  );
}
