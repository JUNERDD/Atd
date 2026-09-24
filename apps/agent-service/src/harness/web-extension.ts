import { Type } from 'typebox';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import {
  WEB_FETCH_MAX_PAGES,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
  WEB_URL_MAX_LENGTH,
} from '@ai/agent-contracts';
import type { HarnessDeps } from './deps.js';
import { throwIfAborted } from './web/bounds.js';
import { fetchPages } from './web/fetch.js';
import { fetchOutput } from './web/fetch-output.js';
import { QUERY_MAX_LENGTH, runSearch } from './web/search.js';

/** Queries per call: each one is a separate provider request. */
const MAX_QUERIES = 4;
const DEFAULT_RESULTS = 5;
const MAX_RESULTS = 10;

const SearchParams = Type.Object({
  query: Type.Optional(
    Type.String({ minLength: 1, maxLength: QUERY_MAX_LENGTH, description: 'Single search query.' }),
  ),
  queries: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: QUERY_MAX_LENGTH }), {
      maxItems: MAX_QUERIES,
      description:
        'Several queries searched concurrently. Prefer 2-4 varied angles for research over near-duplicates.',
    }),
  ),
  numResults: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_RESULTS,
      description: `Results per query (default ${DEFAULT_RESULTS}).`,
    }),
  ),
});

const FetchParams = Type.Object({
  url: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: WEB_URL_MAX_LENGTH,
      description: 'Single URL to fetch.',
    }),
  ),
  urls: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: WEB_URL_MAX_LENGTH }), {
      maxItems: WEB_FETCH_MAX_PAGES,
      description: 'Several URLs fetched in parallel.',
    }),
  ),
});

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/** http(s) URLs only, checked before the gate so a malformed call never asks the user. */
function remoteUrls(values: string[]): string[] {
  const invalid = values.filter((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol !== 'http:' && protocol !== 'https:';
    } catch {
      return true;
    }
  });
  if (invalid.length) throw new Error(`Only http(s) URLs can be fetched: ${invalid.join(', ')}`);
  return values;
}

/**
 * `web_search` / `fetch_content` on the parent session (never inherited by subagents): keyless
 * DuckDuckGo search and readable page fetches, reusing pi-web-access modules (web/package.ts).
 * Every call passes the `web` gate before its first network request, so a declined or aborted
 * gate returns an error result without any request. Result details are the raw shapes
 * documented in web/search.ts and web/fetch-output.ts; the transcript projection
 * (transcript-details/web.ts) turns them into contract §C `webSearch` / `webFetch`.
 */
export function webExtension(deps: HarnessDeps): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: WEB_SEARCH_TOOL,
      label: 'Web search',
      description:
        'Search the web (DuckDuckGo). Returns titles, URLs and snippets per query; use fetch_content to read a result page.',
      parameters: SearchParams,
      async execute(toolCallId, params, signal) {
        const queries = unique([
          ...(params.queries ?? []),
          ...(params.query ? [params.query] : []),
        ]);
        if (!queries.length) throw new Error('Provide `query` or `queries`.');
        if (queries.length > MAX_QUERIES)
          throw new Error(`Search at most ${MAX_QUERIES} queries per call.`);
        await deps.gate({
          toolCallId,
          scope: { tool: 'web' },
          title: 'Search the web',
          detail: queries.join('\n'),
          ...(signal ? { signal } : {}),
        });
        throwIfAborted(signal);
        const { text, details } = await runSearch(
          queries,
          params.numResults ?? DEFAULT_RESULTS,
          signal,
        );
        return { content: [{ type: 'text', text }], details };
      },
    });
    pi.registerTool({
      name: WEB_FETCH_TOOL,
      label: 'Fetch web content',
      description:
        'Fetch http(s) URLs and return their readable content (Markdown for HTML pages, raw text otherwise). Long pages are truncated.',
      parameters: FetchParams,
      async execute(toolCallId, params, signal) {
        const urls = remoteUrls(
          unique([...(params.urls ?? []), ...(params.url ? [params.url] : [])]),
        );
        if (!urls.length) throw new Error('Provide `url` or `urls`.');
        if (urls.length > WEB_FETCH_MAX_PAGES)
          throw new Error(`Fetch at most ${WEB_FETCH_MAX_PAGES} URLs per call.`);
        await deps.gate({
          toolCallId,
          scope: { tool: 'web' },
          title: 'Fetch web content',
          detail: urls.join('\n'),
          ...(signal ? { signal } : {}),
        });
        throwIfAborted(signal);
        const pages = await fetchPages(urls, signal);
        throwIfAborted(signal);
        const { text, details } = fetchOutput(pages);
        return { content: [{ type: 'text', text }], details };
      },
    });
  };
}
