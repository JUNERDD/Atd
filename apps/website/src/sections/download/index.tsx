import { site } from '../../content/site';
import { useCopy } from '../../i18n/lang';
import { Section } from '../../ui/section';
import { downloadCopy } from './copy';
import { LedWord } from './led-word';
import './download.css';

/**
 * The finale on pure black: the name on an LED board, the download, the requirements, and what to
 * expect the first time Atd opens.
 */
export function DownloadSection() {
  const t = useCopy(downloadCopy);

  return (
    <Section id="download" index="A·06" kicker={t.kicker} title={t.title} lede={t.lede} tone="void">
      <div className="download__art" aria-hidden="true">
        <LedWord />
      </div>
      <div className="download__bar reveal">
        <div className="download__actions">
          <a className="btn-filled btn-large download__cta" href={site.latestReleaseUrl}>
            {t.cta}
          </a>
          <a className="btn-plain btn-large download__notes-link" href={site.releasesUrl}>
            {t.releaseNotes}
            <span className="download__chevron" aria-hidden="true">
              ›
            </span>
          </a>
        </div>
        <dl className="download__specs">
          {t.specs.map((spec) => (
            <div className="download__spec" key={spec.label}>
              <dt className="mono-label">{spec.label}</dt>
              <dd>{spec.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="download__notes reveal">
        <p className="download__note">
          <span className="mono-label">{t.firstLaunchLabel}</span>
          <span>{t.firstLaunch}</span>
        </p>
        <p className="download__note">
          <span className="mono-label">{t.updatesLabel}</span>
          <span>{t.updates}</span>
        </p>
      </div>
    </Section>
  );
}
