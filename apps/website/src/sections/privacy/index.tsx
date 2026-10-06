import { useRef } from 'react';
import { useCopy } from '../../i18n/lang';
import { useInView } from '../../lib/use-in-view';
import { Section } from '../../ui/section';
import { privacyCopy } from './copy';
import { PrivacyDiagram } from './diagram';
import './privacy.css';

/**
 * The page's one light section: where requests go, as a schematic of the local service and the
 * providers you connect, then the four local-by-design guarantees. The caption decodes, the
 * schematic assembles along the request path, and each guarantee is its own reveal group: its
 * hairline draws, its code decodes and its text rises, one after another when they arrive together.
 */
export function PrivacySection() {
  const t = useCopy(privacyCopy);
  const diagramRef = useRef<HTMLDivElement>(null);
  const live = useInView(diagramRef, { rootMargin: '120px 0px' });

  return (
    <Section id="privacy" index="A·05" kicker={t.kicker} title={t.title} lede={t.lede} tone="paper">
      <figure className="privacy__figure">
        <figcaption className="privacy__caption mono-label" data-reveal="decode">
          {t.figure}
        </figcaption>
        <p className="sr-only">{t.diagramLabel}</p>
        <PrivacyDiagram ref={diagramRef} live={live} boundary={t.boundary} nodes={t.nodes} />
      </figure>
      <ul className="privacy__points">
        {t.points.map((point, index) => (
          <li className="privacy__point" key={point.title} data-reveal-group="">
            <span className="privacy__hairline" aria-hidden="true" data-reveal="draw" />
            <span className="mono-label" data-reveal="decode" data-reveal-delay="80">
              {`D·${String(index + 1).padStart(2, '0')}`}
            </span>
            <p className="privacy__point-title" data-reveal="rise" data-reveal-delay="120">
              {point.title}
            </p>
            <p className="privacy__point-body" data-reveal="rise" data-reveal-delay="190">
              {point.body}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
