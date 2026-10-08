import { site } from '../../content/site';
import { useCopy } from '../../i18n/lang';
import { Section } from '../../ui/section';
import { downloadCopy } from './copy';
import { LedWord } from './led-word';
import './download.css';

/**
 * The finale: the name on an LED board, the download key under it, and the requirements as
 * readouts in the legend column. The board powers on and lights column by column; the key rises,
 * the readouts decode and the first-launch line follows.
 */
export function DownloadSection() {
  const t = useCopy(downloadCopy);

  return (
    <Section id="download" title={t.title} lede={t.lede}>
      <div className="download__stage">
        <dl className="download__specs" data-reveal-group="" data-reveal-stagger="80">
          {t.specs.map((spec) => (
            <div className="download__spec" key={spec.label} data-reveal="fade">
              <dt className="legend">{spec.label}</dt>
              <dd className="readout" data-reveal="decode">
                {spec.value}
              </dd>
            </div>
          ))}
        </dl>
        <div className="download__main" data-reveal-group="">
          <div className="download__art display" aria-hidden="true" data-reveal="power">
            <LedWord />
          </div>
          <div className="download__actions">
            <a
              className="btn-filled btn-large download__cta"
              href={site.downloadUrl}
              data-reveal="rise"
              data-reveal-delay="420"
            >
              {t.cta}
            </a>
            <p className="download__note legend" data-reveal="fade" data-reveal-delay="520">
              {t.firstLaunch}
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}
