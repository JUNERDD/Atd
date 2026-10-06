import { useRef } from 'react';
import { site } from '../../content/site';
import { useDotField } from '../../gl/use-dot-field';
import { useCopy } from '../../i18n/lang';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { heroCopy, type HeroReading } from './copy';
import './hero.css';

/** The field's pitch range: finer on compact widths, where the wordmark is small. */
const PITCH = [8, 14] as const;

/** A readout value. Keys render as small keycaps; a symbol legend gets its spoken name. */
function ReadingValue({ reading, delay }: { reading: HeroReading; delay: number }) {
  if (!('keys' in reading)) {
    return (
      <dd className="hero__reading-value" data-reveal={reading.effect} data-reveal-delay={delay}>
        {reading.value}
      </dd>
    );
  }
  return (
    <dd className="hero__reading-value">
      {reading.keys.map((key) => (
        <kbd key={key.legend} className="hero__key">
          {key.name === key.legend ? (
            key.legend
          ) : (
            <>
              <span aria-hidden="true">{key.legend}</span>
              <span className="sr-only">{key.name}</span>
            </>
          )}
        </kbd>
      ))}
    </dd>
  );
}

/**
 * The opening section: a black LED panel (the WebGL dot field) with the wordmark lit across its
 * middle, and an instrument strip along the bottom edge. The heading is for assistive tech and
 * search; the lit wordmark is the visible title.
 *
 * The field powers on like a CRT and resolves the wordmark out of static (see gl/shaders.ts). The
 * registration marks and the strip come in on the same clock, after the picture opens. Without
 * WebGL the Doto wordmark and a CSS dot screen stand in for the field (`data-gl="off"`).
 */
export function HeroSection() {
  const t = useCopy(heroCopy);
  const reducedMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLDivElement>(null);

  useDotField(
    { canvas: canvasRef, root: sectionRef, art: markRef },
    { text: site.name, reducedMotion, pitch: PITCH },
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
          <span className="hero__mark-word">{site.name}</span>
        </div>
      </div>
      <div className="hero__instrument container" data-reveal-group="" data-reveal-delay="1000">
        <span className="hero__rule" aria-hidden="true" data-reveal="draw" data-reveal-delay="0" />
        <dl className="hero__readout">
          {t.readings.map((reading, index) => (
            <div
              key={reading.label}
              className="hero__reading"
              data-reveal="rise"
              data-reveal-delay={160 + index * 90}
            >
              <dt className="mono-label">{reading.label}</dt>
              <ReadingValue reading={reading} delay={260 + index * 90} />
            </div>
          ))}
        </dl>
        <span className="hero__cue" aria-hidden="true" data-reveal="fade" data-reveal-delay="700">
          <span className="hero__cue-track">
            <span className="hero__cue-dot" />
          </span>
          <span className="mono-label">{t.scroll}</span>
        </span>
      </div>
    </section>
  );
}
