import { LangProvider } from './i18n/lang-provider';
import type { Lang } from './i18n/routes';
import { usePageMotion } from './motion/use-motion';
import { CasesSection } from './sections/cases';
import { DownloadSection } from './sections/download';
import { FeaturesSection } from './sections/features';
import { SiteFooter } from './sections/footer';
import { HeroSection } from './sections/hero';
import { SiteNav } from './sections/nav';

/** The whole page, rendered once per language by the prerender step and hydrated in the browser. */
export function App({ lang }: { lang: Lang }) {
  usePageMotion();
  return (
    <LangProvider lang={lang}>
      <SiteNav />
      <main id="main">
        <HeroSection />
        <CasesSection />
        <FeaturesSection />
        <DownloadSection />
      </main>
      <SiteFooter />
    </LangProvider>
  );
}
