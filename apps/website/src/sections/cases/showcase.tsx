import { useState } from 'react';
import { cases } from '../../content/cases';
import { useCopy, useLang } from '../../i18n/lang';
import { SectionHeader } from '../../ui/section';
import { casesCopy } from './copy';
import { CaseTabs } from './tabs';
import { CaseDesktop, CaseScene } from './scene';
import { useCaseScroll } from './use-case-scroll';
import './cases.css';

/**
 * Every scene as one scroll sequence on the one desktop, under the section's heading. The stage
 * pins while its track scrolls past, and each step of scrolling brings in the next scene with its
 * caption. Above the screen, the scenes' names light up in turn and each goes straight to its scene
 * (tabs.tsx). The heading pins with the stage when the viewport has room for it beside a full-size
 * screen (use-case-scroll.ts). The prerendered page shows the first scene complete; the scroll
 * drives it once the page hydrates.
 */
export function CasesShowcase({ id }: { id: string }) {
  const t = useCopy(casesCopy);
  const lang = useLang();
  const { root, stage, heading, screen, active, entered, started, select } = useCaseScroll(
    cases.length,
  );
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

  return (
    <div ref={root} className="cases__showcase" data-started={started ? '' : undefined}>
      <div ref={stage} className="cases__stage">
        <div ref={heading} className="cases__heading">
          <SectionHeader id={id} title={t.title} lede={t.lede} />
        </div>
        <CaseTabs
          label={t.index}
          tabs={cases.map((item) => ({ id: item.id, name: item.label[lang] }))}
          active={active}
          onSelect={select}
        />
        <div className="cases__frame">
          <div ref={screen} className="cases__screen display" id="case-screen">
            <CaseDesktop />
            {cases.map((item, index) => (
              <figure
                key={item.id}
                className="cases__slide"
                data-active={active === index ? '' : undefined}
                data-entered={entered && active === index ? '' : undefined}
                aria-label={item.label[lang]}
                aria-hidden={active !== index}
              >
                {failed.has(item.id) ? (
                  <output className="cases__unavailable">
                    {t.imageUnavailable}{' '}
                    <a href={item.image.src} target="_blank" rel="noopener noreferrer">
                      {t.openImage}
                    </a>
                  </output>
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
        <div className="cases__captions" aria-live="polite">
          {cases.map((item, index) => (
            <div
              key={item.id}
              className="cases__caption"
              data-active={active === index ? '' : undefined}
              aria-hidden={active !== index}
            >
              <h3>{item.title[lang]}</h3>
              <p>{item.description[lang]}</p>
            </div>
          ))}
        </div>
      </div>
      {/* One step of scrolling per scene: together they set how long the stage stays pinned. */}
      <div className="cases__steps" aria-hidden="true">
        {cases.map((item) => (
          <span key={item.id} className="cases__space" />
        ))}
      </div>
    </div>
  );
}
