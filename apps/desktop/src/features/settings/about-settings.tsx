import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { showErrorToast } from '../../components/toast-store';
import { aboutLinks } from './about-links';
import { useAppAbout } from './use-app-about';
import './about-settings.css';

/** The product name, as the app bundle and the website spell it; never translated. */
const PRODUCT_NAME = 'Atd';
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/**
 * Settings › About, laid out like a Mac app's About window: the app icon, name and running version
 * centered over the one action, Check for Updates, and three plain text links at the page's
 * bottom. The check opens the shell's own update windows; development builds never update, so
 * there the button stays visible but disabled. Links open in the default browser, which their
 * up-right arrows announce.
 */
export function AboutSettings() {
  const { t } = useTranslation('settings');
  const app = useAppAbout();
  const about = app.state === 'ready' ? app.about : null;
  // The renderer's build mode matches the shell's: only Debug apps load the dev server.
  const development = import.meta.env.DEV;

  // Release builds often reuse the version as the build number; it reads once then. While the
  // shell answers, an empty line holds the layout still.
  let versionLine = t('about.versionUnavailable');
  if (app.state === 'loading') versionLine = NO_BREAK_SPACE;
  else if (about)
    versionLine =
      about.build === about.version
        ? t('about.versionOnly', { version: about.version })
        : t('about.version', { version: about.version, build: about.build });

  function open(url: string) {
    void window.desktop?.agent.openLink(url).catch(showErrorToast);
  }

  return (
    <div className="about-page">
      <section className="about-hero" aria-labelledby="about-product-name">
        <span className="about-app-icon" data-dev={development || undefined} aria-hidden="true" />
        <h2 id="about-product-name" className="about-product-name">
          {PRODUCT_NAME}
        </h2>
        <p className="about-version" aria-live="polite">
          {development ? t('about.developmentVersion', { version: versionLine }) : versionLine}
        </p>
      </section>

      {/* A development build says so in its version line, so its disabled button needs no note
          on screen; assistive technology still hears why. */}
      <div className="about-update" data-settings-anchor="about-check-updates">
        <Button
          disabled={!about?.updates}
          aria-describedby={about && !about.updates ? 'about-update-note' : undefined}
          onClick={() => window.desktop?.about?.checkForUpdates()}
        >
          {t('about.updatesTitle')}
        </Button>
        <span id="about-update-note" className="sr-only">
          {t('about.updatesUnavailable')}
        </span>
      </div>

      <nav className="about-links" aria-label={t('about.links.title')}>
        {aboutLinks.map(({ id, url }) => (
          <Button key={id} asChild variant="link" size="sm">
            <a
              href={url}
              title={url}
              onClick={(event) => {
                event.preventDefault();
                open(url);
              }}
            >
              {t(`about.links.${id}`)}
              <ArrowUpRight data-icon="inline-end" aria-hidden />
            </a>
          </Button>
        ))}
      </nav>
    </div>
  );
}
