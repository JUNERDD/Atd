import { useRef } from 'react';
import { site } from '../../content/site';
import { summonPanels } from '../../content/summon';
import { useCopy, useLang } from '../../i18n/lang';
import { Keycap } from '../../ui/keycap';
import { Section } from '../../ui/section';
import { summonCopy } from './copy';
import { SummonDisplay } from './display';
import { useSummonDemo, type SummonKey } from './use-summon-demo';
import './summon.css';

const KEYS: readonly SummonKey[] = ['meta', 'shift', 'space'];

/** The real panel and its draft stay intact while the visitor shows and hides it. */
export function SummonSection() {
  const t = useCopy(summonCopy);
  const lang = useLang();
  const stageRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const demo = useSummonDemo(stageRef, controlsRef, displayRef);

  const announcement =
    demo.announced === 'shown'
      ? demo.kept
        ? t.announce.back
        : t.announce.shown
      : demo.announced === 'hidden'
        ? t.announce.hidden
        : '';

  return (
    <Section id="summon" title={t.title} lede={t.lede}>
      <div className="summon__stage" ref={stageRef}>
        <div
          className="summon__controls"
          ref={controlsRef}
          data-reveal-group=""
          data-reveal-stagger="80"
        >
          <p className="legend" data-reveal="fade">
            {t.legend}
          </p>
          <p className="summon__keys">
            <span className="summon__caps" aria-hidden="true">
              {KEYS.map((key, index) => (
                <Keycap
                  key={key}
                  label={site.shortcut[index] ?? ''}
                  wide={key === 'space'}
                  pressed={demo.pressed(key)}
                  data-reveal="rise"
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
              data-reveal="rise"
              data-reveal-delay="300"
            >
              {t.tryIt}
            </button>
            <p className="summon__hint legend" data-reveal="fade" data-reveal-delay="400">
              {t.hint}
            </p>
          </div>
          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
        </div>
        <p className="sr-only">{t.diagramLabel}</p>
        <SummonDisplay
          ref={displayRef}
          open={demo.open}
          shot={summonPanels[lang]}
          unavailable={t.unavailable}
        />
      </div>
    </Section>
  );
}
