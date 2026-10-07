import { useCopy } from '../../i18n/lang';
import { DotGlyph } from '../../ui/dot-glyph';
import { Section } from '../../ui/section';
import { featuresCopy } from './copy';
import { FEATURE_IDS, glyphs } from './glyphs';
import './features.css';

/**
 * Four capabilities as a bank of cells ruled into the plate, each a pictogram on a small display, a
 * name and one line. Each cell is its own reveal group: its pictogram lights in a diagonal wave,
 * then the name and line fade up; cells arriving together cascade in reading order.
 */
export function FeaturesSection() {
  const t = useCopy(featuresCopy);

  return (
    <Section id="features" label={t.label} title={t.title}>
      <ul className="feat__bank">
        {FEATURE_IDS.map((id) => (
          <li className="feat__cell" key={id} data-reveal-group="">
            <span className="feat__glyph display">
              <DotGlyph rows={glyphs[id]} wave />
            </span>
            <h3 className="feat__title" data-reveal="fade" data-reveal-delay="240">
              {t.items[id].title}
            </h3>
            <p className="feat__body" data-reveal="fade" data-reveal-delay="320">
              {t.items[id].body}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
