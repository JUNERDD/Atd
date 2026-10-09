import { Section } from '../../ui/section';
import { CasesShowcase } from './showcase';

/**
 * The product's surfaces as one scroll sequence, drawn from the canonical UI designs. The showcase
 * places the section's heading itself, at the top of its stage, so it can pin with the screen.
 */
export function CasesSection() {
  return (
    <Section id="cases">
      <CasesShowcase id="cases" />
    </Section>
  );
}
