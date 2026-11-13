import { LangProvider } from './i18n/lang-provider';
import { postSlugOf, type Lang, type Page } from './i18n/routes';
import { GITHUB_STARS_FALLBACK } from './lib/github-stars';
import { usePageMotion } from './motion/use-motion';
import { BlogIndex } from './pages/blog';
import { BlogPostPage } from './pages/blog/post';
import { DebugPage } from './pages/debug';
import { NotFoundPage } from './pages/not-found';
import { CasesSection } from './sections/cases';
import { DownloadSection } from './sections/download';
import { FeaturesSection } from './sections/features';
import { SiteFooter } from './sections/footer';
import { HeroSection } from './sections/hero';
import { SiteNav } from './sections/nav';

/** The whole page, rendered once per language by the prerender step and hydrated in the browser. */
export function App({
  lang,
  page = 'home',
  initialStars = GITHUB_STARS_FALLBACK,
}: {
  lang: Lang;
  page?: Page;
  initialStars?: number;
}) {
  usePageMotion();
  const slug = postSlugOf(page);
  return (
    <LangProvider lang={lang}>
      {page === 'debug' ? (
        <DebugPage />
      ) : (
        <>
          <SiteNav page={page} initialStars={initialStars} />
          <main id="main">
            {page === 'not-found' ? (
              <NotFoundPage />
            ) : page === 'blog' ? (
              <BlogIndex />
            ) : slug !== null ? (
              <BlogPostPage slug={slug} />
            ) : (
              <>
                <HeroSection />
                <CasesSection />
                <FeaturesSection />
                <DownloadSection />
              </>
            )}
          </main>
          <SiteFooter page={page} />
        </>
      )}
    </LangProvider>
  );
}
