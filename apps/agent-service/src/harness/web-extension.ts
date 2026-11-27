import { Type, type Static, type TSchema } from 'typebox';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import {
  parse,
  WEB_FETCH_MAX_PAGES,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
  WEB_URL_MAX_LENGTH,
} from '@atd/agent-contracts';
import type { ChildTool } from '../subagents/child-tools.js';
import type { HarnessDeps } from './deps.js';
import type { Gate } from './gate.js';
import { throwIfAborted } from './web/bounds.js';
import { fetchPages } from './web/fetch.js';
import { fetchOutput } from './web/fetch-output.js';
import { QUERY_MAX_LENGTH, runSearch } from './web/search.js';

/**
 * Queries per call. Each is a separate DuckDuckGo request, which pi-web-access 0.48 starts at
 * least 10 s after the previous one and refuses, as rate limited, when it could not start within
 * 20 s of the call (web/package.ts). Two is the most a call can search when it follows the
 * previous call directly: its queries start about 10 s and 20 s after that call's last one.
 */
const MAX_QUERIES = 2;
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
        'Up to 2 queries, searched about 10 s apart. Add a second only for a genuinely different angle, never a near-duplicate.',
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
 * `web_search` / `fetch_content`: keyless DuckDuckGo search and readable page fetches, reusing
 * pi-web-access modules (web/package.ts). Every call passes the `web` gate before its first
 * network request, so a declined or aborted gate returns an error result without any request.
 * Result details are the raw shapes documented in web/search.ts and web/fetch-output.ts; the
 * transcript projection (transcript-details/web.ts) turns them into contract §C `webSearch` /
 * `webFetch`. The parent registers them through `webExtension`, subagent children through
 * `childWebTools` with a gate that attributes their confirms to the child execution.
 */
function webTools(gate: Gate) {
  const search = {
    name: WEB_SEARCH_TOOL,
    label: 'Web search',
    description:
      'Search the web (DuckDuckGo). Returns titles, URLs and snippets per query; use fetch_content to read a result page. Searches are rate limited to about one every 10 s and 10 every 10 minutes; a query over that limit fails as rate limited, so search with few, well-chosen queries.',
    parameters: SearchParams,
    async execute(toolCallId: string, params: Static<typeof SearchParams>, signal?: AbortSignal) {
      const queries = unique([...(params.queries ?? []), ...(params.query ? [params.query] : [])]);
      if (!queries.length) throw new Error('Provide `query` or `queries`.');
      if (queries.length > MAX_QUERIES)
        throw new Error(`Search at most ${MAX_QUERIES} queries per call.`);
      await gate({
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
      return { content: [{ type: 'text' as const, text }], details };
    },
  };
  const fetch = {
    name: WEB_FETCH_TOOL,
    label: 'Fetch web content',
    description:
      'Fetch http(s) URLs and return their readable content (Markdown for HTML pages, extracted text for PDFs, raw text otherwise). Long pages are truncated.',
    parameters: FetchParams,
    async execute(toolCallId: string, params: Static<typeof FetchParams>, signal?: AbortSignal) {
      const urls = remoteUrls(
        unique([...(params.urls ?? []), ...(params.url ? [params.url] : [])]),
      );
      if (!urls.length) throw new Error('Provide `url` or `urls`.');
      if (urls.length > WEB_FETCH_MAX_PAGES)
        throw new Error(`Fetch at most ${WEB_FETCH_MAX_PAGES} URLs per call.`);
      await gate({
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
      return { content: [{ type: 'text' as const, text }], details };
    },
  };
  return { search, fetch };
}

/** The parent session's web tools, gated by the session's own gate. */
export function webExtension(deps: HarnessDeps): ExtensionFactory {
  return (pi) => {
    const { search, fetch } = webTools(deps.gate);
    pi.registerTool(search);
    pi.registerTool(fetch);
  };
}

/**
 * A child's registrations of the same tools. The child bridge passes raw arguments, so they are
 * validated against the tool schema before the tool runs, as Pi does for the parent.
 */
export function childWebTools(gate: Gate, allowed: readonly string[]): ChildTool[] {
  const { search, fetch } = webTools(gate);
  return [childTool(search), childTool(fetch)].filter((tool) => allowed.includes(tool.name));
}

function childTool<T extends TSchema>(tool: {
  name: string;
  label: string;
  description: string;
  parameters: T;
  execute(
    id: string,
    params: Static<T>,
    signal?: AbortSignal,
  ): Promise<{ content: { type: 'text'; text: string }[]; details: unknown }>;
}): ChildTool {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    execute: (id, args, signal) => tool.execute(id, parse(tool.parameters, args), signal),
  };
}
