import { WEB_FETCH_MAX_PAGES } from '@atd/agent-contracts';
import { clip } from './bounds.js';
import type { FetchedPage } from './fetch.js';

/** Characters of page content the model receives per call, shared evenly by the pages. */
const TEXT_BUDGET = 40_000;

/**
 * One page of the `fetch_content` result details, shaped like pi-web-access `ExtractedContent`
 * (extract.ts) so the transcript projection (transcript-details/web.ts) reads it: `content` is
 * the text the model received (at most its share of `TEXT_BUDGET`), `length` the full extracted
 * length before that cut.
 */
export interface FetchResultPage {
  url: string;
  title: string;
  content: string;
  length: number;
  error?: string;
}

/** Raw `fetch_content` details; the projection turns them into contract §C `webFetch`. */
export interface FetchRawDetails {
  results: FetchResultPage[];
}

export interface FetchOutput {
  text: string;
  details: FetchRawDetails;
}

function pageText(page: FetchedPage, body: string): string {
  if (page.error) return `## ${page.url}\nFetch failed: ${page.error}`;
  const note =
    body.length < page.content.length
      ? `\n\n[Truncated: showing ${body.length} of ${page.content.length} characters.]`
      : '';
  return `## ${page.title || page.url}\nURL: ${page.url}\n\n${body}${note}`;
}

/**
 * The model text (each page's content within an even share of `TEXT_BUDGET`) and the raw
 * details, which hold the same bounded content so the session never stores whole pages. When
 * every URL failed the call fails instead, so an error result never carries details.
 */
export function fetchOutput(pages: FetchedPage[]): FetchOutput {
  if (pages.every((page) => page.error))
    throw new Error(
      `Fetching failed. ${pages.map((page) => `${page.url}: ${page.error ?? ''}`).join('; ')}`,
    );
  const budget = Math.floor(TEXT_BUDGET / Math.max(1, pages.length));
  const bodies = pages.map((page) => clip(page.content, budget));
  return {
    text: pages.map((page, index) => pageText(page, bodies[index] ?? '')).join('\n\n'),
    details: {
      results: pages.slice(0, WEB_FETCH_MAX_PAGES).map((page, index) => ({
        url: page.url,
        title: page.title,
        content: bodies[index] ?? '',
        length: page.content.length,
        ...(page.error ? { error: page.error } : {}),
      })),
    },
  };
}
