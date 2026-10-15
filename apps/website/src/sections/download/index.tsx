import { Fragment } from 'react';
import { site } from '../../content/site';
import { useCopy, useLang } from '../../i18n/lang';
import { Section } from '../../ui/section';
import { downloadCopy } from './copy';
import { LedWord } from './led-word';
import './download.css';

/**
 * The finale: the name on an LED board, a download key per chip family under it, and the
 * requirements and the license as readouts in the legend column. The visitor picks their Mac's chip;
 * nothing guesses it; a last note links each chip's preview build. The board powers on and lights
 * column by column; the keys rise, the readouts decode and the notes follow.
 */
export function DownloadSection() {
  const t = useCopy(downloadCopy);
  const lang = useLang();

  return (
    <Section id="download" title={t.title} lede={t.lede}>
      <div className="download__stage">
        <dl className="download__specs" data-reveal-group="" data-reveal-stagger="80">
          {t.specs.map((spec) => (
            <div className="download__spec" key={spec.label} data-reveal="fade">
              <dt className="legend">{spec.label}</dt>
              {/* A text effect only plays on an element holding just its text, so a linked
                  readout decodes in its link. */}
              {spec.href ? (
                <dd className="readout">
                  <a className="download__link" href={spec.href} data-reveal="decode">
                    {spec.value}
                  </a>
                </dd>
              ) : (
                <dd className="readout" data-reveal="decode">
                  {spec.value}
                </dd>
              )}
            </div>
          ))}
        </dl>
        <div className="download__main" data-reveal-group="">
          <div className="download__art display" aria-hidden="true" data-reveal="power">
            <LedWord />
          </div>
          <div className="download__actions">
            <ul className="download__keys" aria-label={t.choose}>
              {site.downloads.map((download, index) => (
                <li className="download__key" key={download.arch}>
                  <a
                    className="btn-filled btn-large download__cta"
                    href={download.url}
                    data-reveal="rise"
                    data-reveal-delay={420 + index * 80}
                  >
                    {t.key(download.chip[lang])}
                  </a>
                </li>
              ))}
            </ul>
            <div className="download__notes" data-reveal="fade" data-reveal-delay="580">
              <p className="download__note legend">{t.which}</p>
              <p className="download__note legend">{t.firstLaunch}</p>
              <p className="download__note legend">
                {t.preview}
                {site.downloads.map((download, index) => (
                  <Fragment key={download.arch}>
                    {index > 0 && ' · '}
                    <a className="download__link" href={download.previewUrl}>
                      {download.chip[lang]}
                    </a>
                  </Fragment>
                ))}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
