import { useRef, useState } from 'react';
import { useCopy } from '../../i18n/lang';
import { useInView } from '../../lib/use-in-view';
import { Section } from '../../ui/section';
import { PrivacyBoard } from './board';
import { privacyCopy, type ModelMode } from './copy';

const MODES: readonly ModelMode[] = ['cloud', 'local'];

/**
 * Where your data lives, answered on one board: what stays on the Mac and what leaves it. The
 * switch above it moves the model from a provider to this Mac, and the outbound side empties. The
 * prerendered page shows the cloud case, which is the one with something to explain; the switch
 * works once the page hydrates. The "never" legends close the plate.
 */
export function PrivacySection() {
  const t = useCopy(privacyCopy);
  const [mode, setMode] = useState<ModelMode>('cloud');
  const boardRef = useRef<HTMLDivElement>(null);
  const live = useInView(boardRef, { rootMargin: '120px 0px' });

  return (
    <Section id="privacy" title={t.title} lede={t.lede}>
      <div className="privacy__demo">
        <fieldset className="privacy__modes" data-reveal="fade">
          <legend className="sr-only">{t.modeLabel}</legend>
          {MODES.map((id) => (
            <button
              key={id}
              type="button"
              className="privacy__mode"
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
            >
              {t.modes[id]}
            </button>
          ))}
        </fieldset>
        <PrivacyBoard
          ref={boardRef}
          mode={mode}
          live={live}
          zones={t.zones}
          kept={t.kept}
          model={t.model[mode]}
          out={t.out[mode]}
        />
        <ul className="privacy__never" data-reveal-group="">
          {t.never.map((item) => (
            <li className="privacy__never-item legend" key={item} data-reveal="fade">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
