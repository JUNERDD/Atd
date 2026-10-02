import { CircleAlert, Globe, Link } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WebFetchDetails, WebFetchPage, WebSearchDetails } from '@atd/agent-contracts';
import { ToolCard } from './tool-card';
import { SourceItem } from './web-source';
import './tool-list.css';

/** The closing note when the projection dropped results or cut text. */
function TruncatedFooter({ truncated }: { truncated: boolean }) {
  const { t } = useTranslation('tasks');
  return truncated ? <ToolCard.Footer>{t('web.truncated')}</ToolCard.Footer> : null;
}

/**
 * `web_search` results in one card: the header names the query (or how many ran) with the
 * result tally and provider, several queries list as chips, and each result reads as a source
 * with its snippet clamped to two lines.
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
  const queries = details.queries;
  const label =
    queries.length === 1
      ? queries[0]
      : queries.length > 1
        ? t('toolCount.query', { count: queries.length })
        : tally;
  const facts = queries.length > 0 ? [tally, details.provider] : [details.provider];
  const meta = facts.filter(Boolean).join(' · ');
  return (
    <ToolCard.Root>
      <ToolCard.Header icon={<Globe />} label={label} meta={meta} copyText={copyText} />
      <ToolCard.Body size="lg">
        {queries.length > 1 && (
          <ul className="web-queries">
            {queries.map((query, index) => (
              <li key={`${index}:${query}`} className="web-query font-mono" title={query}>
                {query}
              </li>
            ))}
          </ul>
        )}
        {count === 0 ? (
          <p className="tool-list-empty">{t('web.noResults')}</p>
        ) : (
          <ul className="web-sources">
            {details.results.map((result, index) => (
              <SourceItem key={`${index}:${result.url}`} url={result.url} title={result.title}>
                {result.snippet && (
                  <p className="web-source-snippet" title={result.snippet}>
                    {result.snippet}
                  </p>
                )}
              </SourceItem>
            ))}
          </ul>
        )}
      </ToolCard.Body>
      <TruncatedFooter truncated={details.truncated} />
    </ToolCard.Root>
  );
}

/**
 * One fetched page: its length beside the host, then the excerpt under a quote rule, or why the
 * page could not be fetched (an icon and words, not color alone).
 */
function PageItem({ page }: { page: WebFetchPage }) {
  const { t, i18n } = useTranslation('tasks');
  const length = page.error
    ? undefined
    : t('web.pageLength', {
        length: page.length.toLocaleString(i18n.resolvedLanguage ?? i18n.language),
      });
  return (
    <SourceItem url={page.url} title={page.title} meta={length}>
      {page.error ? (
        <>
          <p className="web-source-error">
            <CircleAlert aria-hidden />
            {t('web.fetchFailed')}
          </p>
          <p className="web-source-snippet" title={page.error}>
            {page.error}
          </p>
        </>
      ) : (
        page.excerpt && (
          <blockquote className="web-source-excerpt" title={page.excerpt}>
            {page.excerpt}
          </blockquote>
        )
      )}
    </SourceItem>
  );
}

/** `fetch_content` pages in one card: one source per URL with its length and excerpt or error. */
export function WebFetchBody({
  details,
  copyText,
}: {
  details: WebFetchDetails;
  copyText: string;
}) {
  const { t } = useTranslation('tasks');
  return (
    <ToolCard.Root>
      <ToolCard.Header
        icon={<Link />}
        label={t('toolCount.page', { count: details.pages.length })}
        copyText={copyText}
      />
      <ToolCard.Body size="lg">
        <ul className="web-sources">
          {details.pages.map((page, index) => (
            <PageItem key={`${index}:${page.url}`} page={page} />
          ))}
        </ul>
      </ToolCard.Body>
      <TruncatedFooter truncated={details.truncated} />
    </ToolCard.Root>
  );
}
