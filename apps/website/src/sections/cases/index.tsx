import { useCopy } from '../../i18n/lang';
import { Section } from '../../ui/section';
import { casesCopy } from './copy';
import { CasesGallery } from './gallery';

/** "In practice": screen recordings of real tasks, in a gallery that scrolls sideways. */
export function CasesSection() {
  const t = useCopy(casesCopy);
  return (
    <Section id="cases" index="A·04" kicker={t.kicker} title={t.title} lede={t.lede} tone="void">
      <CasesGallery />
    </Section>
  );
}
