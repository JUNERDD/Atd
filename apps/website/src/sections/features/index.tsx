import { useCopy } from '../../i18n/lang';
import { LedBoard } from '../../ui/led-board';
import { Section } from '../../ui/section';
import { FEATURE_IDS, featuresCopy } from './copy';
import { CHANNELS } from './glyphs';
import './features.css';

/**
 * The five capabilities on one LED display set into the plate, a channel each: every channel lights
 * its capability's pictogram, and its name and one line are printed on the plate beside or beneath
 * it. Each capability is its own reveal group, so channels arriving together power on in reading
 * order: the display opens, its dots come up and the pictogram lights column by column. Under a fine
 * pointer the dots swell like a loupe, as the download board's do.
 */
export function FeaturesSection() {
  const t = useCopy(featuresCopy);

  return (
    <Section id="features" title={t.title}>
      <ul className="feat">
        {FEATURE_IDS.map((id) => (
          <li key={id} className="feat__item" data-reveal-group="">
            <div className="feat__channel display" data-reveal="power">
              <LedBoard rows={CHANNELS[id]} delay={240} />
            </div>
            <div className="feat__copy">
              <h3 className="feat__name" data-reveal="fade" data-reveal-delay="400">
                {t.items[id].title}
              </h3>
              <p className="feat__line" data-reveal="fade" data-reveal-delay="480">
                {t.items[id].body}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
