import { ArrowLeft, ArrowRight, ArrowUpRight, Pause, Play } from 'lucide-react';
import { useState } from 'react';
import { cases } from '../../content/cases';
import { useCopy, useLang } from '../../i18n/lang';
import { casesCopy } from './copy';
import { CaseDesktop, CaseScene } from './scene';
import { useCasesCarousel } from './use-cases-carousel';
import './cases.css';

const pad = (value: number) => String(value).padStart(2, '0');

/** One carousel for every desktop scene, with explicit navigation and playback controls. */
export function CasesShowcase() {
  const t = useCopy(casesCopy);
  const lang = useLang();
  const {
    root,
    progress,
    intervalSeconds,
    viewport,
    active,
    started,
    entered,
    playing,
    rotationEnabled,
    pauseOnFocus,
    select,
    previous,
    next,
    toggle,
  } = useCasesCarousel();
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const current = cases[active] ?? cases[0];

  return (
    <section
      ref={root}
      className="cases__showcase"
      aria-label={t.views}
      aria-roledescription={t.carousel}
      data-started={started ? '' : undefined}
      onFocusCapture={pauseOnFocus}
    >
      <ol className="cases__views" aria-label={t.views} data-reveal-group="">
        {cases.map((item, index) => (
          <li key={item.id} data-reveal="fade">
            <button
              type="button"
              className="cases__view"
              aria-pressed={active === index}
              aria-controls="case-carousel"
              onClick={() => select(index)}
            >
              {item.label[lang]}
            </button>
          </li>
        ))}
      </ol>
      <div className="cases__screen display" id="case-carousel">
        <CaseDesktop />
        <div ref={viewport} className="cases__viewport">
          <div className="cases__slides">
            {cases.map((item, index) => (
              <figure
                key={item.id}
                className="cases__slide"
                data-entered={entered && active === index ? '' : undefined}
                aria-label={`${index + 1} / ${cases.length} · ${item.label[lang]}`}
                aria-roledescription={t.slide}
                aria-hidden={active !== index}
              >
                {failed.has(item.id) ? (
                  <output className="cases__unavailable">{t.imageUnavailable}</output>
                ) : (
                  <CaseScene
                    id={item.id}
                    layers={item.layers}
                    alt={item.image.alt[lang]}
                    onError={() => setFailed((previous) => new Set(previous).add(item.id))}
                  />
                )}
              </figure>
            ))}
          </div>
        </div>
      </div>
      <div className="cases__caption">
        <div
          className="cases__description"
          aria-live={playing ? 'off' : 'polite'}
          aria-atomic="true"
        >
          <h3>{current.title[lang]}</h3>
          <p>{current.description[lang]}</p>
        </div>
        <div className="cases__controls">
          <div className="cases__timing">
            <span className="cases__position readout">
              {pad(active + 1)} / {pad(cases.length)}
            </span>
            <span className="cases__timer" title={t.interval(intervalSeconds)}>
              <span className="cases__timer-track" aria-hidden="true">
                <span ref={progress} className="cases__timer-fill" />
              </span>
              <span className="readout">{t.duration(intervalSeconds)}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={previous}
            aria-label={t.previous}
            aria-controls="case-carousel"
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={toggle}
            aria-label={rotationEnabled ? t.pause : t.play}
            aria-controls="case-carousel"
          >
            {rotationEnabled ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </button>
          <button type="button" onClick={next} aria-label={t.next} aria-controls="case-carousel">
            <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="cases__footer">
        <p>{t.note}</p>
        <a
          className="cases__original"
          href={current.image.src}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${t.openImage} · ${current.label[lang]}`}
        >
          {t.openImage}
          <ArrowUpRight aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
