import { diffWords } from 'diff';
import type { CommandProgressState } from '../../client/agent/bridge';

type ReviewState = NonNullable<Extract<CommandProgressState, { phase: 'answer' }>['review']>;
/** One run of an answer's changes against the text it rewrote (`CommandReviewSchema.changes`). */
export type ReviewChange = NonNullable<ReviewState['changes']>[number];

/**
 * How much of the two texts a diff must keep for the answer to count as a rewrite of the source:
 * twice the characters both keep over the characters of both, whitespace left out (the
 * Ratcliff/Obershelp ratio). A polish or a correction keeps most of the source (around 0.6 and
 * up, a light one far more); a translation keeps almost nothing but names, numbers and
 * punctuation (well under 0.2), and so does a rewrite that starts over, whose marks would cover
 * the whole answer. Below it the card shows the answer plain, under its source.
 */
const REWRITE_RATIO = 0.5;
/** The most runs the card takes (`CommandReviewSchema.changes`); more drops the changes. */
const MAX_CHANGES = 4000;
/** Texts longer than this together are not diffed: the card would mark too much to read. */
const MAX_DIFF_LENGTH = 40_000;
/** How long the diff may take on the page before it gives up and the card shows no changes. */
const DIFF_TIMEOUT_MS = 150;

/**
 * Splits text into words wherever the language needs it: Chinese and Japanese, written without
 * spaces, are cut by the engine's dictionary rather than one run per sentence.
 */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

function solid(text: string): number {
  return text.replace(/\s/gu, '').length;
}

/**
 * The answer marked against `source`, the text the run read in place of the selection, as the
 * review card shows it: what both keep, what the answer adds and what it drops, word by word
 * (jsdiff's `diffWords`, which keeps the answer's own whitespace in what both keep). Undefined
 * when there is no source, the answer is not a rewrite of it (`REWRITE_RATIO`), nothing changed,
 * the texts are too long or the diff too slow, or the runs exceed what the card takes. The runs
 * without the dropped ones spell the answer exactly, or none are given.
 */
export function reviewChanges(
  source: string | undefined,
  answer: string,
): ReviewChange[] | undefined {
  if (!source || source.length + answer.length > MAX_DIFF_LENGTH) return undefined;
  const diff = diffWords(source, answer, { intlSegmenter: segmenter, timeout: DIFF_TIMEOUT_MS });
  if (!diff) return undefined;
  const changes: ReviewChange[] = [];
  let kept = 0;
  for (const { value, added, removed } of diff) {
    if (!value) continue;
    const kind = added ? 'insert' : removed ? 'delete' : 'same';
    if (kind === 'same') kept += solid(value);
    changes.push({ kind, text: value });
  }
  const total = solid(source) + solid(answer);
  if (total === 0 || (2 * kept) / total < REWRITE_RATIO) return undefined;
  if (changes.every((change) => change.kind === 'same') || changes.length > MAX_CHANGES)
    return undefined;
  const spelled = changes
    .filter((change) => change.kind !== 'delete')
    .map((change) => change.text)
    .join('');
  return spelled === answer ? changes : undefined;
}
