import { useState } from 'react';
import { caseBackdrop, caseImage, caseGroups, cases } from '../../content/cases';
import { useCopy, useLang } from '../../i18n/lang';
import { casesCopy } from './copy';
import { CaseSteps } from './steps';
import { useCaseTimeline } from './use-case-timeline';
import './cases.css';

/** Each case's id, which is also its step's link hash. */
const caseIds = cases.map((item) => item.id);

const pad = (count: number) => String(count).padStart(2, '0');

function CaseBackdrop() {
  return (
    <img
      className="cases__backdrop"
      src={caseBackdrop}
      width={1440}
      height={900}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

/** Static Figma compositions follow the reading line on a shared stage, or stack on narrow screens. */
export function CasesShowcase() {
  const t = useCopy(casesCopy);
  const lang = useLang();
  const { root, frame, display, active, playing, reach, choose } = useCaseTimeline(caseIds);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const groupName = (id: string) => caseGroups.find((group) => group.id === id)?.name[lang] ?? '';
  const current = cases[active] ?? cases[0];

  const picture = (item: (typeof cases)[number]) =>
    failed.has(`${lang}/${item.id}`) ? (
      <output className="cases__unavailable">{t.imageUnavailable}</output>
    ) : (
      <img
        className="cases__image"
        src={caseImage(item.id, lang)}
        width={1440}
        height={900}
        alt={item.alt[lang]}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed((previous) => new Set(previous).add(`${lang}/${item.id}`))}
      />
    );

  return (
    <div ref={root} className="cases__showcase">
      <CaseSteps
        frame={frame}
        label={t.index}
        active={active}
        playing={playing}
        onSelect={choose}
        steps={cases.map((item, index) => ({
          id: item.id,
          group: groupName(item.group),
          groupStart: cases[index - 1]?.group !== item.group,
          title: item.title[lang],
          description: item.description[lang],
          media: (
            <div className="cases__shot">
              <CaseBackdrop />
              {picture(item)}
            </div>
          ),
        }))}
      />
      <div className="cases__aside">
        <div className="cases__hold">
          <p className="cases__slate" aria-hidden="true">
            <span className="cases__where">
              <span className="legend">{groupName(current.group)}</span>
              <span className="cases__surface">{current.label[lang]}</span>
            </span>
            <span className="cases__count readout">
              {pad(active + 1)}
              <span className="cases__total"> / {pad(cases.length)}</span>
            </span>
          </p>
          <div ref={display} className="cases__screen" id="case-screen">
            <CaseBackdrop />
            {cases.map((item, index) => (
              <figure
                key={item.id}
                className="cases__slide"
                data-active={active === index ? '' : undefined}
                data-deferred={index > reach ? '' : undefined}
                aria-label={item.label[lang]}
                aria-hidden={active !== index}
              >
                {picture(item)}
              </figure>
            ))}
          </div>
          <div className="cases__subtitles" aria-hidden="true">
            {cases.map((item, index) => (
              <p
                key={item.id}
                className="cases__caption"
                data-active={active === index ? '' : undefined}
              >
                {item.caption[lang][0]}
                <em>{item.caption[lang][1]}</em>
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
