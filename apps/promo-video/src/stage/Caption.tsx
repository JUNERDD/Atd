import { copy, htmlLang, type Lang } from '../copy.ts';
import { easeIn, ramp } from '../motion/ease.ts';
import { CASE_IDS, CASE_LENGTH, CHOREO, type CaseId } from '../timeline.ts';
import { Keycaps } from '../ui/Keycaps.tsx';
import { KineticText } from '../ui/KineticText.tsx';
import './caption.css';
import { useCaseTime } from './cases/case-time.ts';

/** The caption leaves a beat before its scene does, so the next one has a clean page. */
const EXIT = CASE_LENGTH - 0.46;

/** The scene's number in dot-matrix digits, flickering on like an LED readout, and its name. */
function Readout({ t, index, label }: { t: number; index: number; label: string }) {
  const lit = t > 0.18 || Math.floor(t / 0.045) % 2 === 0;
  const shown = t < 0 ? 0 : (lit ? 1 : 0.12) * (1 - ramp(t, EXIT - 0.04, 0.24, easeIn));
  return (
    <div className="readout" style={{ '--o': shown }}>
      <span className="readout__number">{String(index + 1).padStart(2, '0')}</span>
      <span className="readout__rule" />
      <span className="readout__label">{label}</span>
    </div>
  );
}

/** A scene's caption in the column left of the screen. */
export function Caption({ id, lang }: { id: CaseId; lang: Lang }) {
  const t = useCaseTime();
  const text = copy[lang].cases[id];
  const keys = CHOREO.summon.keys;

  return (
    <div className="caption" lang={htmlLang(lang)}>
      <div className="caption__column">
        <Readout t={t} index={CASE_IDS.indexOf(id)} label={text.label} />
        <KineticText
          className="caption__title"
          t={t}
          // Chinese headlines break after their comma, the way the phrase reads.
          text={lang === 'zh' ? text.title.replace('，', '，\n') : text.title}
          lang={lang}
          at={0.06}
          exitAt={EXIT}
        />
        <KineticText
          className="caption__body"
          t={t}
          text={text.body}
          lang={lang}
          at={0.36}
          exitAt={EXIT + 0.04}
          stagger={lang === 'zh' ? 0.026 : 0.016}
          rise={0.5}
        />
        {id === 'summon' ? (
          <div className="caption__keys" style={{ '--o': 1 - ramp(t, EXIT, 0.3, easeIn) }}>
            <Keycaps t={t} appearAt={-0.42} pressAt={keys} releaseAt={(keys[2] ?? 0) + 0.32} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
