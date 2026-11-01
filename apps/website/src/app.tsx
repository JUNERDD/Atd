import { LangProvider } from './i18n/lang-provider';
import type { Lang, Page } from './i18n/routes';
import { usePageMotion } from './motion/use-motion';
import { DebugPage } from './pages/debug';
import { CasesSection } from './sections/cases';
import { DownloadSection } from './sections/download';
import { FeaturesSection } from './sections/features';
import { SiteFooter } from './sections/footer';
import { HeroSection } from './sections/hero';
import { SiteNav } from './sections/nav';

/** The whole page, rendered once per language by the prerender step and hydrated in the browser. */
export function App({ lang, page = 'home' }: { lang: Lang; page?: Page }) {
  usePageMotion();
  return (
    <LangProvider lang={lang}>
      {page === 'debug' ? (
        <DebugPage />
      ) : (
        <>
          <SiteNav />
          <main id="main">
            <HeroSection />
            <CasesSection />
            <FeaturesSection />
            <DownloadSection />
          </main>
          <SiteFooter />
        </>
      )}
    </LangProvider>
  );
}
