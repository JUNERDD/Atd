import { useRef } from 'react';
import { useCopy } from '../../i18n/lang';
import { useInView } from '../../lib/use-in-view';
import { Section } from '../../ui/section';
import { privacyCopy } from './copy';
import { PrivacyDiagram } from './diagram';

/** Where requests go, as a schematic of the Mac's local parts and the providers you connect. */
export function PrivacySection() {
  const t = useCopy(privacyCopy);
  const diagramRef = useRef<HTMLDivElement>(null);
  const live = useInView(diagramRef, { rootMargin: '120px 0px' });

  return (
    <Section id="privacy" title={t.title} lede={t.lede}>
      <p className="sr-only">{t.diagramLabel}</p>
      <PrivacyDiagram ref={diagramRef} live={live} boundary={t.boundary} nodes={t.nodes} />
    </Section>
  );
}
