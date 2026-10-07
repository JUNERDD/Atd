import { useCopy } from '../../i18n/lang';
import { Section } from '../../ui/section';
import { casesCopy } from './copy';
import { CasesShowcase } from './showcase';

/** Product surfaces, illustrated with exports of the canonical UI designs. */
export function CasesSection() {
  const t = useCopy(casesCopy);
  return (
    <Section id="cases" title={t.title} lede={t.lede}>
      <CasesShowcase />
    </Section>
  );
}
