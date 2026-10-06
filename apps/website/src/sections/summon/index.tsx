import { useRef } from 'react';
import { site } from '../../content/site';
import { useCopy } from '../../i18n/lang';
import { Keycap } from '../../ui/keycap';
import { Section } from '../../ui/section';
import { summonCopy } from './copy';
import { SummonDisplay } from './display';
import { useSummonDemo, type SummonKey } from './use-summon-demo';
import './summon.css';

const KEYS: readonly SummonKey[] = ['meta', 'shift', 'space'];

/**
 * The shortcut on three keycaps beside a true-scale drawing of the panel in its corner. The real
 * chord, or the Try it button, shows and hides the drawn panel; its draft survives.
 */
export function SummonSection() {
  const t = useCopy(summonCopy);
  const stageRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const demo = useSummonDemo(stageRef, displayRef);

  const announcement =
    demo.announced === 'shown'
      ? demo.kept
        ? t.announce.back
        : t.announce.shown
      : demo.announced === 'hidden'
        ? t.announce.hidden
        : '';

  return (
    <Section id="summon" index="A·01" kicker={t.kicker} title={t.title} lede={t.lede}>
      <div className="summon__stage" ref={stageRef}>
        <div className="summon__controls">
          <p className="summon__keys">
            <span className="summon__caps" aria-hidden="true">
              {KEYS.map((key, index) => (
                <Keycap
                  key={key}
                  label={site.shortcut[index] ?? ''}
                  wide={key === 'space'}
                  pressed={demo.pressed(key)}
                />
              ))}
            </span>
            <span className="sr-only">{t.shortcutName}</span>
          </p>
          <div className="summon__actions">
            <button
              type="button"
              className="btn-bordered summon__try"
              aria-pressed={demo.open}
              onClick={demo.toggle}
            >
              {t.tryIt}
            </button>
            <p className="summon__hint">{t.hint}</p>
          </div>
          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
        </div>
        <p className="sr-only">{t.diagramLabel}</p>
        <SummonDisplay
          ref={displayRef}
          open={demo.open}
          kept={demo.kept}
          live={demo.near}
          state={t.state[demo.phase]}
          draft={t.draft}
          draftKept={t.draftKept}
        />
        <dl className="summon__readouts">
          {t.readouts.map((readout) => (
            <div className="summon__readout" key={readout.label}>
              <dt className="mono-label">{readout.label}</dt>
              <dd>{readout.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
