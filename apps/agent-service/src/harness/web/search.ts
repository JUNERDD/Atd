import { clip, failure, oneLine, throwIfAborted } from './bounds.js';
import { loadWebPackage, searchHits, type SearchHit } from './package.js';

/** Provider id reported in the details; the only provider (keyless). */
export const SEARCH_PROVIDER = 'duckduckgo';
/** Query length accepted by the tool; matches the details' per-query bound. */
export const QUERY_MAX_LENGTH = 500;
/** Snippet characters per result in the model text. */
const TEXT_SNIPPET_LENGTH = 300;

type QueryOutcome = { query: string; hits: SearchHit[] } | { query: string; error: string };

/**
 * Raw `web_search` details, shaped like pi-web-access search results (perplexity.ts
 * `SearchResult`) so the transcript projection (transcript-details/web.ts) turns them into
 * contract §C `webSearch`: every query's hits in order, deduplicated by URL.
 */
export interface SearchRawDetails {
  provider: string;
  queries: string[];
  results: SearchHit[];
}

export interface SearchOutput {
  text: string;
  details: SearchRawDetails;
}

function queryText(outcome: QueryOutcome): string {
  if ('error' in outcome) return `## ${outcome.query}\nSearch failed: ${outcome.error}`;
  if (outcome.hits.length === 0) return `## ${outcome.query}\nNo results.`;
  const lines = outcome.hits.map((hit, index) => {
    const snippet = clip(oneLine(hit.snippet), TEXT_SNIPPET_LENGTH);
    return `${index + 1}. ${oneLine(hit.title)}\n   ${hit.url}${snippet ? `\n   ${snippet}` : ''}`;
  });
  return `## ${outcome.query}\n${lines.join('\n')}`;
}

function searchDetails(queries: string[], outcomes: QueryOutcome[]): SearchRawDetails {
  const byUrl = new Map<string, SearchHit>();
  for (const outcome of outcomes) {
    if ('error' in outcome) continue;
    for (const hit of outcome.hits) if (!byUrl.has(hit.url)) byUrl.set(hit.url, hit);
  }
  return { provider: SEARCH_PROVIDER, queries, results: [...byUrl.values()] };
}

/**
 * Runs every query against the keyless DuckDuckGo provider concurrently (the package bounds each
 * request to 30 s and honors `signal`). One failed query is reported in the text; when all fail,
 * the call fails. Call only after the web gate allowed the call.
 */
export async function runSearch(
  queries: string[],
  numResults: number,
  signal: AbortSignal | undefined,
): Promise<SearchOutput> {
  const web = await loadWebPackage();
  const requestSignal = signal ?? new AbortController().signal;
  const settled = await Promise.allSettled(
    queries.map((query) => web.searchDuckDuckGo(query, { numResults, signal: requestSignal })),
  );
  throwIfAborted(signal);
  const outcomes = settled.map((result, index): QueryOutcome => {
    const query = queries[index] ?? '';
    return result.status === 'fulfilled'
      ? { query, hits: searchHits(result.value.results) }
      : { query, error: failure(result.reason) };
  });
  if (outcomes.every((outcome) => 'error' in outcome))
    throw new Error(
      `Web search failed. ${outcomes.map((outcome) => `${outcome.query}: ${'error' in outcome ? outcome.error : ''}`).join('; ')}`,
    );
  return {
    text: outcomes.map(queryText).join('\n\n'),
    details: searchDetails(queries, outcomes),
  };
}
