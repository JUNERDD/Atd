import { useTranslation } from 'react-i18next';
import type { WebFetchDetails, WebFetchPage, WebSearchDetails } from '@ai/agent-contracts';
import { DetailBox } from './detail-box';
import { ExternalLink } from './external-link';

/** Host of a result URL for the compact source line; the raw value when it does not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function TruncatedNote({ truncated }: { truncated: boolean }) {
  const { t } = useTranslation('tasks');
  return truncated ? <p className="m-0 text-muted-foreground">{t('web.truncated')}</p> : null;
}

/**
 * One source row shared by search results and fetched pages: the title opens the URL in the
 * system browser, the host names the source, and the body text clamps with the full value on
 * hover. Every line truncates so a long URL never widens the panel.
 */
function SourceRow({
  url,
  title,
  meta,
  text,
  error,
}: {
  url: string;
  title: string;
  meta?: string;
  text: string;
  error?: string;
}) {
  const { t } = useTranslation('tasks');
  const host = hostOf(url);
  return (
    <li className="flex min-w-0 flex-col">
      <ExternalLink
        href={url}
        title={url}
        className="min-w-0 truncate font-medium text-foreground underline-offset-4 hover:underline"
      >
        {title || t('web.openLink')}
      </ExternalLink>
      <p className="m-0 min-w-0 truncate text-muted-foreground" title={url}>
        {meta ? `${host} · ${meta}` : host}
      </p>
      {error ? (
        <p className="m-0 line-clamp-3 min-w-0 wrap-anywhere text-destructive" title={error}>
          {t('web.fetchFailed')} <span className="text-muted-foreground">{error}</span>
        </p>
      ) : (
        text && (
          <p className="m-0 line-clamp-3 min-w-0 wrap-anywhere text-muted-foreground" title={text}>
            {text}
          </p>
        )
      )}
    </li>
  );
}

/**
 * `web_search` results: the tally and provider, the queries when the call ran several, then one
 * source row per result.
 */
export function WebSearchBody({
  details,
  copyText,
}: {
  details: WebSearchDetails;
  copyText: string;
}) {
  const { t } = useTranslation('tasks');
  const count = details.results.length;
  const tally = count === 1 ? t('web.resultsOne') : t('web.results', { count });
  return (
    <DetailBox variant="output" copyText={copyText}>
      <p className="m-0 min-w-0 truncate text-muted-foreground">
        {details.provider ? `${tally} · ${details.provider}` : tally}
      </p>
      {details.queries.length > 1 && (
        <ul className="m-0 flex list-none flex-col p-0 text-muted-foreground">
          {details.queries.map((query, index) => (
            <li key={`${index}:${query}`} className="min-w-0 truncate" title={query}>
              {query}
            </li>
          ))}
        </ul>
      )}
      {count === 0 ? (
        <p className="m-0 text-muted-foreground">{t('web.noResults')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {details.results.map((result, index) => (
            <SourceRow
              key={`${index}:${result.url}`}
              url={result.url}
              title={result.title}
              text={result.snippet}
            />
          ))}
        </ul>
      )}
      <TruncatedNote truncated={details.truncated} />
    </DetailBox>
  );
}

function PageRow({ page }: { page: WebFetchPage }) {
  const { t, i18n } = useTranslation('tasks');
  const length = page.error
    ? undefined
    : t('web.pageLength', {
        length: page.length.toLocaleString(i18n.resolvedLanguage ?? i18n.language),
      });
  return (
    <SourceRow
      url={page.url}
      title={page.title}
      meta={length}
      text={page.excerpt}
      error={page.error}
    />
  );
}

/** `fetch_content` pages: one source row per URL, with its length, excerpt, or error. */
export function WebFetchBody({
  details,
  copyText,
}: {
  details: WebFetchDetails;
  copyText: string;
}) {
  return (
    <DetailBox variant="output" copyText={copyText}>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {details.pages.map((page, index) => (
          <PageRow key={`${index}:${page.url}`} page={page} />
        ))}
      </ul>
      <TruncatedNote truncated={details.truncated} />
    </DetailBox>
  );
}
