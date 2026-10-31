import { useState } from 'react';
import { caseClip, caseGroups, cases } from '../../content/cases';
import { useCopy, useLang } from '../../i18n/lang';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { CaseClipView } from './clip';
import { casesCopy } from './copy';
import { CaseGlow } from './glow';
import { CaseSteps } from './steps';
import { useCaseTimeline } from './use-case-timeline';
import './cases.css';

/** Each case's id, which is also its step's link hash. */
const caseIds = cases.map((item) => item.id);

const pad = (count: number) => String(count).padStart(2, '0');

/**
 * Every case as a timeline: the steps scroll in a column beside a stage that holds still, and the
 * step nearest the stage's middle is current, so its clip plays on the stage
 * (use-case-timeline.ts). The clips are cut from the product films, so the stage is shot like
 * them: a frameless 16:9 screen that casts its clip's light onto the plate around it, a slate
 * above naming the current group and surface and counting the cases, and the case's caption below
 * it like a subtitle under a picture. Where there is no room beside the steps, the stage is left
 * out and each step shows its own clip under its own title and line. The prerendered page, and
 * reduced motion, show each clip's poster; clips beyond the scroll's reach stay unrendered.
 */
export function CasesShowcase() {
  const t = useCopy(casesCopy);
  const lang = useLang();
  const still = useReducedMotion();
  const { root, frame, display, active, playing, reach, choose } = useCaseTimeline(caseIds);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const groupName = (id: string) => caseGroups.find((group) => group.id === id)?.name[lang] ?? '';
  const current = cases[active] ?? cases[0];

  const clip = (item: (typeof cases)[number], index: number, preload: boolean) =>
    failed.has(item.id) ? (
      <output className="cases__unavailable">
        {t.clipUnavailable}{' '}
        <a href={caseClip(item.id, lang).video} target="_blank" rel="noopener noreferrer">
          {t.openClip}
        </a>
      </output>
    ) : (
      <CaseClipView
        clip={caseClip(item.id, lang)}
        alt={item.alt[lang]}
        play={playing && !still && index === active}
        preload={preload && !still}
        onError={() => setFailed((previous) => new Set(previous).add(item.id))}
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
          media: <div className="cases__shot">{clip(item, index, false)}</div>,
        }))}
      />
      <div className="cases__aside">
        <div className="cases__hold">
          <CaseGlow screen={display} active={active} />
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
            {cases.map((item, index) => (
              <figure
                key={item.id}
                className="cases__slide"
                data-active={active === index ? '' : undefined}
                data-deferred={index > reach ? '' : undefined}
                aria-label={item.label[lang]}
                aria-hidden={active !== index}
              >
                {clip(item, index, playing && index >= active - 1 && index <= reach)}
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
