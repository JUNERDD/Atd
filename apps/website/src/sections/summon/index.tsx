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
 * How a readout's value enters: figures count up, Latin words decode; other scripts (Chinese) have
 * nothing to scramble and simply rise with their row.
 */
function readoutEffect(value: string): 'count' | 'decode' | undefined {
  if (/\d/u.test(value)) return 'count';
  if (/[a-z]/iu.test(value)) return 'decode';
  return undefined;
}

/**
 * The shortcut on three keycaps beside a true-scale drawing of the panel in its corner. The real
 * chord, or the Try it button, shows and hides the drawn panel; its draft survives.
 *
 * Three reveal groups enter on their own triggers: the keycaps rise one after another and the button
 * and hint follow; the drawing plots itself (display.tsx); the readout rows rise in sequence with
 * their values counting or decoding. Then the chord presses itself and the panel springs up.
 */
export function SummonSection() {
  const t = useCopy(summonCopy);
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
    <Section id="summon" index="A·01" kicker={t.kicker} title={t.title} lede={t.lede}>
      <div className="summon__stage" ref={stageRef}>
        <div
          className="summon__controls"
          ref={controlsRef}
          data-reveal-group=""
          data-reveal-stagger="80"
        >
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
            <p className="summon__hint" data-reveal="fade" data-reveal-delay="400">
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
          kept={demo.kept}
          live={demo.near}
          state={t.state[demo.phase]}
          draft={t.draft}
          draftKept={t.draftKept}
        />
        <dl className="summon__readouts" data-reveal-group="">
          {t.readouts.map((readout) => {
            const effect = readoutEffect(readout.value);
            return (
              <div
                className="summon__readout"
                key={readout.label}
                data-reveal="rise"
                data-reveal-group=""
              >
                <dt className="mono-label">{readout.label}</dt>
                <dd data-reveal={effect} data-reveal-delay={effect ? 160 : undefined}>
                  {readout.value}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </Section>
  );
}
