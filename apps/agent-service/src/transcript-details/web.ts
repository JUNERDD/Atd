import { Type } from 'typebox';
import { Compile } from 'typebox/compile';
import {
  WEB_EXCERPT_MAX_LENGTH,
  WEB_FETCH_MAX_PAGES,
  WEB_SEARCH_MAX_QUERIES,
  WEB_SEARCH_MAX_RESULTS,
  WEB_SNIPPET_MAX_LENGTH,
  WEB_TITLE_MAX_LENGTH,
  WEB_URL_MAX_LENGTH,
  type WebFetchDetails,
  type WebFetchPage,
  type WebSearchDetails,
  type WebSearchResult,
} from '@atd/agent-contracts';
import { createClamp, stringItems, type Clamp } from './clamp.js';

const QUERY_MAX_LENGTH = 500;
const PROVIDER_MAX_LENGTH = 64;
const FETCH_ERROR_MAX_LENGTH = 1000;

/**
 * Raw details of the web extension's tools, built from pi-web-access data types. `web_search`
 * returns `results` as the per-query `QueryResultData[]` (storage.ts) or as flat
 * `SearchResult[]` (perplexity.ts) with a top-level `provider`; `fetch_content` returns the
 * `ExtractedContent[]` of `fetchAllContent` (extract.ts) as `results`. pi-web-access's own tool
 * details carry counts and storage ids only, so without these arrays there is nothing to show.
 */
const RawSearchDetailsValidator = Compile(
  Type.Object({
    queries: Type.Optional(Type.Unknown()),
    provider: Type.Optional(Type.Unknown()),
    results: Type.Array(Type.Unknown()),
  }),
);
const RawQueryResultValidator = Compile(
  Type.Object({
    query: Type.String(),
    provider: Type.Optional(Type.Unknown()),
    results: Type.Array(Type.Unknown()),
  }),
);
const RawSearchResultValidator = Compile(
  Type.Object({
    url: Type.String(),
    title: Type.Optional(Type.String()),
    snippet: Type.Optional(Type.String()),
  }),
);
const RawFetchDetailsValidator = Compile(Type.Object({ results: Type.Array(Type.Unknown()) }));
const RawPageValidator = Compile(
  Type.Object({
    url: Type.String(),
    title: Type.Optional(Type.String()),
    content: Type.Optional(Type.String()),
    /** Full extracted length when the tool kept only a bounded `content`. */
    length: Type.Optional(Type.Integer({ minimum: 0 })),
    error: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
);

/**
 * Only whole http(s) URLs cross the boundary: the renderer offers them as links, and a clamped
 * URL would point somewhere else.
 */
function safeUrl(url: string, clamp: Clamp): string | undefined {
  if (url.length <= WEB_URL_MAX_LENGTH && /^https?:\/\//i.test(url)) return url;
  clamp.drop();
  return undefined;
}

function searchResult(raw: unknown, clamp: Clamp): WebSearchResult | undefined {
  if (!RawSearchResultValidator.Check(raw)) {
    clamp.drop();
    return undefined;
  }
  const url = safeUrl(raw.url, clamp);
  if (url === undefined) return undefined;
  return {
    title: clamp.text(raw.title ?? '', WEB_TITLE_MAX_LENGTH),
    url,
    snippet: clamp.text(raw.snippet ?? '', WEB_SNIPPET_MAX_LENGTH),
  };
}

export function projectWebSearchDetails(raw: unknown): WebSearchDetails | undefined {
  if (!RawSearchDetailsValidator.Check(raw)) return undefined;
  const clamp = createClamp();
  const queries: string[] = [];
  const providers: string[] = typeof raw.provider === 'string' ? [raw.provider] : [];
  const found: unknown[] = [];
  for (const item of raw.results) {
    if (RawQueryResultValidator.Check(item)) {
      queries.push(item.query);
      if (typeof item.provider === 'string') providers.push(item.provider);
      found.push(...item.results);
    } else found.push(item);
  }
  const results: WebSearchResult[] = [];
  for (const item of found) {
    const result = searchResult(item, clamp);
    if (result) results.push(result);
  }
  const listed = stringItems(raw.queries);
  return {
    type: 'webSearch',
    queries: clamp
      .list(listed.length ? listed : queries, WEB_SEARCH_MAX_QUERIES)
      .map((query) => clamp.text(query, QUERY_MAX_LENGTH)),
    provider: clamp.text(providers[0] ?? '', PROVIDER_MAX_LENGTH),
    results: clamp.list(results, WEB_SEARCH_MAX_RESULTS),
    truncated: clamp.truncated,
  };
}

function fetchedPage(raw: unknown, clamp: Clamp): WebFetchPage | undefined {
  if (!RawPageValidator.Check(raw)) {
    clamp.drop();
    return undefined;
  }
  const url = safeUrl(raw.url, clamp);
  if (url === undefined) return undefined;
  const content = raw.content ?? '';
  return {
    url,
    title: clamp.text(raw.title ?? '', WEB_TITLE_MAX_LENGTH),
    excerpt: clamp.text(content, WEB_EXCERPT_MAX_LENGTH),
    length: raw.length ?? content.length,
    ...(raw.error ? { error: clamp.text(raw.error, FETCH_ERROR_MAX_LENGTH) } : {}),
  };
}

export function projectWebFetchDetails(raw: unknown): WebFetchDetails | undefined {
  if (!RawFetchDetailsValidator.Check(raw)) return undefined;
  const clamp = createClamp();
  const pages: WebFetchPage[] = [];
  for (const item of clamp.list(raw.results, WEB_FETCH_MAX_PAGES)) {
    const page = fetchedPage(item, clamp);
    if (page) pages.push(page);
  }
  return { type: 'webFetch', pages, truncated: clamp.truncated };
}
