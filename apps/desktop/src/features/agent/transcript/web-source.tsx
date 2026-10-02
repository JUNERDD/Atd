import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from './external-link';
import './tool-list.css';

/** Host of a result URL without a leading `www.`; the raw value when it does not parse. */
function hostOf(url: string): string {
  try {
    const host = new URL(url).host;
    return host ? host.replace(/^www\./, '') : url;
  } catch {
    return url;
  }
}

/** Second-level labels that sit under a country code (`bbc.co.uk`, `example.com.cn`). */
const SHORT_SECOND_LEVEL = 3;

/**
 * The letter that stands for a source: the first character of its registrable name, so
 * `docs.github.com` reads as G. Without the public suffix list this approximates: under a
 * two-letter country code a short second level (`co.uk`, `com.cn`) is skipped too. IP addresses
 * and single labels use their first character.
 */
function monogramOf(host: string): string {
  const hostname = host.replace(/:\d+$/, '');
  const labels = hostname.split('.').filter(Boolean);
  let name = labels[0] ?? hostname;
  if (labels.length >= 2 && !/^[\d.]+$/.test(hostname)) {
    const top = labels.at(-1) ?? '';
    const second = labels.at(-2) ?? '';
    const underCountry = top.length === 2 && second.length <= SHORT_SECOND_LEVEL;
    name = (underCountry && labels.length >= 3 ? labels.at(-3) : second) ?? second;
  }
  return (Array.from(name)[0] ?? '').toUpperCase();
}

/**
 * One web source, shared by search results and fetched pages: a monogram of the host (never a
 * network favicon), the title opening the URL in the system browser, the host with an optional
 * fact, then the source's own text below. Every line truncates or clamps so a long URL never
 * widens the panel; the full URL reads on hover.
 */
export function SourceItem({
  url,
  title,
  meta,
  children,
}: {
  url: string;
  title: string;
  meta?: string | undefined;
  children?: ReactNode;
}) {
  const { t } = useTranslation('tasks');
  const host = hostOf(url);
  return (
    <li className="web-source">
      <span aria-hidden className="web-source-mark">
        {monogramOf(host)}
      </span>
      <div className="web-source-main">
        <ExternalLink href={url} title={url} className="web-source-title">
          {title || t('web.openLink')}
        </ExternalLink>
        <p className="web-source-host" title={url}>
          {meta ? `${host} · ${meta}` : host}
        </p>
        {children}
      </div>
    </li>
  );
}
