import { useRef } from 'react';
import { useCopy } from '../../i18n/lang';
import { useInView } from '../../lib/use-in-view';
import { Section } from '../../ui/section';
import { privacyCopy } from './copy';
import { PrivacyDiagram } from './diagram';
import './privacy.css';

/**
 * The page's one light section: where requests go, as a schematic of the local service and the
 * providers you connect, then the four local-by-design guarantees.
 */
export function PrivacySection() {
  const t = useCopy(privacyCopy);
  const diagramRef = useRef<HTMLDivElement>(null);
  const live = useInView(diagramRef, { rootMargin: '120px 0px' });

  return (
    <Section id="privacy" index="A·05" kicker={t.kicker} title={t.title} lede={t.lede} tone="paper">
      <figure className="privacy__figure reveal">
        <figcaption className="privacy__caption mono-label">{t.figure}</figcaption>
        <p className="sr-only">{t.diagramLabel}</p>
        <PrivacyDiagram ref={diagramRef} live={live} boundary={t.boundary} nodes={t.nodes} />
      </figure>
      <ul className="privacy__points">
        {t.points.map((point, index) => (
          <li className="privacy__point reveal" key={point.title}>
            <span className="mono-label">{`D·${String(index + 1).padStart(2, '0')}`}</span>
            <p className="privacy__point-title">{point.title}</p>
            <p className="privacy__point-body">{point.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
