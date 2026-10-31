import { useCopy } from '../../i18n/lang';
import { Section } from '../../ui/section';
import { casesCopy } from './copy';
import { CasesShowcase } from './showcase';

/** The product's surfaces as a timeline of scenes, drawn from the canonical UI designs. */
export function CasesSection() {
  const t = useCopy(casesCopy);
  return (
    <Section id="cases" title={t.title} lede={t.lede}>
      <CasesShowcase />
    </Section>
  );
}
