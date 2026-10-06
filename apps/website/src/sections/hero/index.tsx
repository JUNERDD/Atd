import { useRef } from 'react';
import { site } from '../../content/site';
import { useDotField } from '../../gl/use-dot-field';
import { useCopy } from '../../i18n/lang';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { heroCopy, type HeroReading } from './copy';
import './hero.css';

/** A readout value. Keys render as small keycaps; a symbol legend gets its spoken name. */
function ReadingValue({ reading }: { reading: HeroReading }) {
  if (!('keys' in reading)) return reading.value;
  return reading.keys.map((key) => (
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
  ));
}

/**
 * The opening section: a black LED panel (the WebGL dot field) with the wordmark lit across it, the
 * headline floating on a defocused patch over the wordmark's lower part, and an instrument strip
 * along the bottom edge. Without WebGL the Doto wordmark and a CSS dot screen stand in for the field;
 * once the field draws, the section carries `data-gl="live"` and the fallback fades out.
 */
export function HeroSection() {
  const t = useCopy(heroCopy);
  const reducedMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDListElement>(null);

  useDotField(
    { canvas: canvasRef, root: sectionRef, art: markRef, focus: [copyRef, readoutRef] },
    { text: site.name, reducedMotion, focusDim: 0.75 },
  );

  return (
    <section ref={sectionRef} id="top" className="hero" aria-labelledby="hero-title">
      <canvas ref={canvasRef} className="hero__canvas" aria-hidden="true" />
      <div className="hero__stage">
        <span className="hero__reg" data-corner="start" aria-hidden="true" />
        <span className="hero__reg" data-corner="end" aria-hidden="true" />
        <div ref={markRef} className="hero__mark" aria-hidden="true">
          <span className="hero__mark-word">{site.name}</span>
        </div>
        <div ref={copyRef} className="hero__copy">
          <p className="hero__kicker mono-label">
            <span className="hero__index">{t.index}</span>
            <span>{t.kicker}</span>
          </p>
          <h1 id="hero-title" className="hero__title">
            {t.title.map((phrase) => (
              <span key={phrase} className="hero__phrase">
                {phrase}
              </span>
            ))}
          </h1>
          <p className="hero__lede">{t.lede}</p>
          <div className="hero__actions">
            <a className="btn-filled btn-large" href={site.latestReleaseUrl}>
              {t.download}
            </a>
            <a className="btn-plain btn-large" href={site.repoUrl}>
              {t.github}
              <span aria-hidden="true">›</span>
            </a>
          </div>
          <p className="hero__note">{t.requirements}</p>
        </div>
      </div>
      <div className="hero__instrument container">
        <dl ref={readoutRef} className="hero__readout">
          {t.readings.map((reading) => (
            <div key={reading.label} className="hero__reading">
              <dt className="mono-label">{reading.label}</dt>
              <dd className="hero__reading-value">
                <ReadingValue reading={reading} />
              </dd>
            </div>
          ))}
        </dl>
        <span className="hero__cue" aria-hidden="true">
          <span className="hero__cue-track">
            <span className="hero__cue-dot" />
          </span>
          <span className="mono-label">{t.scroll}</span>
        </span>
      </div>
    </section>
  );
}
