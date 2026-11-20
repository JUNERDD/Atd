import { LangProvider } from './i18n/lang-provider';
import { featureSlugOf, postSlugOf, type Lang, type Page } from './i18n/routes';
import { GITHUB_STARS_FALLBACK } from './lib/github-stars';
import { usePageMotion } from './motion/use-motion';
import { BlogIndex } from './pages/blog';
import { BlogPostPage } from './pages/blog/post';
import { DebugPage } from './pages/debug';
import { FaqPage } from './pages/faq';
import { FeaturesHub } from './pages/features';
import { CapabilityPage } from './pages/features/capability';
import { NotFoundPage } from './pages/not-found';
import { CasesSection } from './sections/cases';
import { DownloadSection } from './sections/download';
import { FeaturesSection } from './sections/features';
import { SiteFooter } from './sections/footer';
import { HeroSection } from './sections/hero';
import { SiteNav } from './sections/nav';

/** What the page's `<main>` holds: the home page's sections, or the one page the route names. */
function PageMain({ page }: { page: Page }) {
  if (page === 'not-found') return <NotFoundPage />;
  if (page === 'blog') return <BlogIndex />;
  if (page === 'features') return <FeaturesHub />;
  if (page === 'faq') return <FaqPage />;
  const post = postSlugOf(page);
  if (post !== null) return <BlogPostPage slug={post} />;
  const feature = featureSlugOf(page);
  if (feature !== null) return <CapabilityPage slug={feature} />;
  return (
    <>
      <HeroSection />
      <CasesSection />
      <FeaturesSection />
      <DownloadSection />
    </>
  );
}

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
  return (
    <LangProvider lang={lang}>
      {page === 'debug' ? (
        <DebugPage />
      ) : (
        <>
          <SiteNav page={page} initialStars={initialStars} />
          <main id="main">
            <PageMain page={page} />
          </main>
          <SiteFooter page={page} />
        </>
      )}
    </LangProvider>
  );
}
