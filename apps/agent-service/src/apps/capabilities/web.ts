import {
  WEB_SNIPPET_MAX_LENGTH,
  WEB_TITLE_MAX_LENGTH,
  WEB_URL_MAX_LENGTH,
  type WebFetchInput,
  type WebFetchOutput,
  type WebSearchInput,
  type WebSearchResult,
} from '@atd/agent-contracts';
import { fetchPages } from '../../harness/web/fetch.js';
import { runSearch } from '../../harness/web/search.js';
import { AppFailure } from '../errors.js';

/** Results when the app names no limit. */
const DEFAULT_RESULTS = 5;
/** `web.fetch` text bound (the output schema's). */
const MAX_TEXT = 1_000_000;

/**
 * `web.search` and `web.fetch` through the agent's own web tooling (harness/web: keyless
 * DuckDuckGo search and readable page fetches, pi-web-access). The app's `web` consent stands in
 * for the task's `web` gate; nothing else differs from the agent's tools.
 */
export async function webSearch(
  input: WebSearchInput,
  signal: AbortSignal,
): Promise<{ results: WebSearchResult[] }> {
  const limit = input.limit ?? DEFAULT_RESULTS;
  const { details } = await runSearch([input.query], limit, signal);
  return {
    results: details.results
      .filter((hit) => hit.url.length <= WEB_URL_MAX_LENGTH)
      .slice(0, limit)
      .map((hit) => ({
        title: hit.title.slice(0, WEB_TITLE_MAX_LENGTH),
        url: hit.url,
        snippet: hit.snippet.slice(0, WEB_SNIPPET_MAX_LENGTH),
      })),
  };
}

export async function webFetch(input: WebFetchInput, signal: AbortSignal): Promise<WebFetchOutput> {
  const [page] = await fetchPages([input.url], signal);
  if (!page || page.error)
    throw new AppFailure(502, 'upstream_failed', page?.error ?? 'The page could not be fetched.');
  return {
    url: page.url.slice(0, WEB_URL_MAX_LENGTH),
    title: page.title.slice(0, 300),
    text: page.content.slice(0, MAX_TEXT),
  };
}
