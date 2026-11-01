import { useCopy, useLang } from '../../i18n/lang';
import { langPath } from '../../i18n/routes';
import { LanguageMenu } from '../../sections/nav/language-menu';
import { debugCopy } from './copy';
import { useDebugDownloads } from './use-debug-downloads';
import './debug.css';

export function DebugPage() {
  const t = useCopy(debugCopy);
  const lang = useLang();
  const { state, retry } = useDebugDownloads();
  const stable = `${langPath[lang]}#download`;
  return (
    <div className="debug-page plate">
      <a className="skip-link" href="#main">
        {t.skip}
      </a>
      <header className="debug-page__header container">
        <a className="debug-page__brand" href={langPath[lang]} aria-label={t.home}>
          Atd
        </a>
        <LanguageMenu page="debug" />
      </header>
      <main id="main" className="debug-page__main container">
        <div className="debug-page__intro">
          <p className="legend">{t.label}</p>
          <h1 className="dot-text">{t.title}</h1>
          <p className="debug-page__lede">{t.description}</p>
        </div>
        <section
          className="debug-page__downloads"
          aria-label={t.choose}
          aria-busy={state.status === 'loading'}
        >
          {state.status === 'ready' ? (
            <>
              <dl className="debug-page__facts">
                <div>
                  <dt className="legend">{t.version}</dt>
                  <dd>{state.build.version}</dd>
                </div>
                <div>
                  <dt className="legend">{t.recording}</dt>
                  <dd>{t.profiles[state.build.profile]}</dd>
                </div>
              </dl>
              <ul className="debug-page__installers">
                {state.build.downloads.map((download) => (
                  <li className="debug-page__installer" key={download.arch}>
                    <h2>{t.chips[download.arch]}</h2>
                    <p className="legend">
                      {t.requires(download.minMacOS)} · {Math.ceil(download.bytes / 1024 ** 2)} MB
                    </p>
                    <a className="btn-filled btn-large" href={download.url}>
                      {t.download(t.chips[download.arch])}
                    </a>
                    <details className="debug-page__checksum">
                      <summary>{t.checksum}</summary>
                      <code>{download.sha256}</code>
                    </details>
                  </li>
                ))}
              </ul>
              <p className="legend">{t.which}</p>
            </>
          ) : (
            <div className="debug-page__status">
              <output>{t[state.status]}</output>
              {state.status !== 'loading' && (
                <button className="btn-bordered" type="button" onClick={retry}>
                  {t.retry}
                </button>
              )}
            </div>
          )}
          <noscript>
            <p>{t.noScript}</p>
          </noscript>
        </section>
        <section className="debug-page__instructions" aria-labelledby="debug-before">
          <h2 id="debug-before">{t.before}</h2>
          <p>{t.environment}</p>
          <h2>{t.stepsTitle}</h2>
          <ol>
            {t.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="legend">{t.privacy}</p>
        </section>
        <footer className="debug-page__footer">
          <p>{t.returnNote}</p>
          <a className="btn-bordered" href={stable}>
            {t.stable}
          </a>
        </footer>
      </main>
    </div>
  );
}
