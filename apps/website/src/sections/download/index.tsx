import { site } from '../../content/site';
import { useCopy } from '../../i18n/lang';
import { Section } from '../../ui/section';
import { downloadCopy } from './copy';
import { LedWord } from './led-word';
import './download.css';

/**
 * The finale on pure black: the name on an LED board, the download, the requirements, and what to
 * expect the first time Atd opens. The board powers on first; the bar's hairlines draw, its links
 * rise and its readouts decode; the notes follow.
 */
export function DownloadSection() {
  const t = useCopy(downloadCopy);

  return (
    <Section id="download" index="A·06" kicker={t.kicker} title={t.title} lede={t.lede} tone="void">
      <div className="download__art" aria-hidden="true" data-reveal-group="">
        <LedWord />
      </div>
      <div className="download__bar" data-reveal-group="" data-reveal-delay="120">
        <span className="download__rule" data-edge="top" aria-hidden="true" data-reveal="draw" />
        <span
          className="download__rule"
          data-edge="bottom"
          aria-hidden="true"
          data-reveal="draw"
          data-reveal-delay="120"
        />
        <div className="download__actions">
          <a
            className="btn-filled btn-large download__cta"
            href={site.latestReleaseUrl}
            data-reveal="rise"
            data-reveal-delay="160"
          >
            {t.cta}
          </a>
          <a
            className="btn-plain btn-large download__notes-link"
            href={site.releasesUrl}
            data-reveal="rise"
            data-reveal-delay="240"
          >
            {t.releaseNotes}
            <span className="download__chevron" aria-hidden="true">
              ›
            </span>
          </a>
        </div>
        <dl className="download__specs">
          {t.specs.map((spec, index) => (
            <div
              className="download__spec"
              key={spec.label}
              data-reveal="rise"
              data-reveal-delay={300 + index * 80}
            >
              <dt className="mono-label">{spec.label}</dt>
              <dd data-reveal="decode" data-reveal-delay={380 + index * 80}>
                {spec.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="download__notes" data-reveal-group="" data-reveal-stagger="120">
        <p className="download__note" data-reveal="rise">
          <span className="mono-label">{t.firstLaunchLabel}</span>
          <span>{t.firstLaunch}</span>
        </p>
        <p className="download__note" data-reveal="rise">
          <span className="mono-label">{t.updatesLabel}</span>
          <span>{t.updates}</span>
        </p>
      </div>
    </Section>
  );
}
