import { LangProvider } from './i18n/lang-provider';
import type { Lang } from './i18n/routes';
import { AutomationsSection } from './sections/automations';
import { CasesSection } from './sections/cases';
import { DownloadSection } from './sections/download';
import { FeaturesSection } from './sections/features';
import { SiteFooter } from './sections/footer';
import { HeroSection } from './sections/hero';
import { SiteNav } from './sections/nav';
import { PrivacySection } from './sections/privacy';
import { SummonSection } from './sections/summon';

/** The whole page, rendered once per language by the prerender step and hydrated in the browser. */
export function App({ lang }: { lang: Lang }) {
  return (
    <LangProvider lang={lang}>
      <SiteNav />
      <main id="main">
        <HeroSection />
        <SummonSection />
        <FeaturesSection />
        <AutomationsSection />
        <CasesSection />
        <PrivacySection />
        <DownloadSection />
      </main>
      <SiteFooter />
    </LangProvider>
  );
}
