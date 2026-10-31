import { closestRegion, presentRegion } from './candidates.js';
import { editedText, failureText, type Change, type Problem } from './edit-messages.js';
import { fuzzyView, type FuzzyView } from './fuzzy-match.js';
import { locate, type EditEntry, type Miss, type Span } from './matching.js';
import { renderReplacement, type Rendered } from './replacement.js';
import { lineAt, lineStarts, storedOffset, type LineRange, type TextView } from './text-view.js';

/** An edit call applied in memory, ready to write. */
export interface EditOutcome {
  /** The edited text as stored, without the BOM. */
  readonly text: string;
  /** Its LF view, for the transcript diff. */
  readonly lf: string;
  /** What the model reads back. */
  readonly message: string;
}

/**
 * Applies an edit call's entries to a file's text, all at once or not at all. Every entry matches
 * the original text (matching.ts); the matched spans must not overlap; each is replaced by its
 * rendered newText (replacement.ts) and every byte outside the spans is kept. Throws an Error whose
 * message tells the model how to fix the call (edit-messages.ts) when any entry cannot apply or
 * the call would change nothing.
 */
export function applyEdits(
  view: TextView,
  entries: readonly EditEntry[],
  path: string,
): EditOutcome {
  const starts = once(() => lineStarts(view.lf));
  const fuzzy = once(() => fuzzyView(view.lf, starts()));
  const failure = (problems: readonly Problem[]) =>
    new Error(failureText(path, entries.length, problems, { lf: view.lf, starts: starts() }));
  const { spans, misses } = locate(view.lf, entries, fuzzy);
  if (misses.length > 0) throw failure(misses.map((miss) => problemOf(miss, view, starts, fuzzy)));
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const overlaps = overlapsOf(spans, starts);
  if (overlaps.length > 0) throw failure(overlaps);
  const written = assemble(view, spans);
  if ('collision' in written) {
    const { entry, end } = written.collision;
    throw failure([{ kind: 'collision', entry, line: lineAt(starts(), end) }]);
  }
  if (written.text === view.text) throw failure([{ kind: 'unchanged' }]);
  const after = { lf: written.lf, starts: lineStarts(written.lf) };
  const changes: Change[] = [];
  const changed = new Set<number>();
  for (const { span, rendered, original, at } of written.placed) {
    if (rendered.stored === original) continue;
    changed.add(span.entry);
    const lines = changedLines(view.lf.slice(span.start, span.end), rendered.lf, at, after.starts);
    changes.push({ entry: span.entry, fuzzy: span.fuzzy, ...lines });
  }
  const unchanged = entries.flatMap((_, entry) => (changed.has(entry) ? [] : [entry]));
  return {
    text: written.text,
    lf: written.lf,
    message: editedText(path, entries.length, spans.length, changes, unchanged, after),
  };
}

/** A miss in terms the model can act on: line numbers, and where the text likely is. */
function problemOf(
  miss: Miss,
  view: TextView,
  starts: () => Int32Array,
  fuzzy: () => FuzzyView,
): Problem {
  switch (miss.kind) {
    case 'empty':
      return miss;
    case 'ambiguous':
      return {
        kind: 'ambiguous',
        entry: miss.entry,
        fuzzy: miss.fuzzy,
        lines: miss.at.map((at) => lineAt(starts(), at)),
        capped: miss.capped,
      };
    case 'missing': {
      const { edit } = miss;
      const emptyFile = view.lf.length === 0;
      const present = emptyFile ? undefined : presentRegion(view.lf, starts(), edit.newText);
      const closest = emptyFile ? undefined : closestRegion(fuzzy(), edit.oldText);
      return {
        kind: 'missing',
        entry: miss.entry,
        replaceAll: edit.replaceAll,
        emptyFile,
        present,
        closest,
      };
    }
  }
}

/**
 * Pairs of entries whose spans overlap, each pair once, with their lines. Spans arrive sorted by
 * start, so each is checked against the earlier span that reaches furthest.
 */
function overlapsOf(spans: readonly Span[], starts: () => Int32Array): Problem[] {
  const problems: Problem[] = [];
  const seen = new Set<string>();
  const lines = (span: Span): LineRange => ({
    first: lineAt(starts(), span.start),
    last: lineAt(starts(), Math.max(span.start, span.end - 1)),
  });
  let reach: Span | undefined;
  for (const span of spans) {
    if (reach !== undefined && reach.end > span.start) {
      const [a, b] = reach.entry < span.entry ? [reach, span] : [span, reach];
      const pair = `${a.entry}:${b.entry}`;
      if (!seen.has(pair)) {
        seen.add(pair);
        problems.push({
          kind: 'overlap',
          entries: [a.entry, b.entry],
          ranges: [lines(a), lines(b)],
        });
      }
    }
    if (reach === undefined || span.end > reach.end) reach = span;
  }
  return problems;
}

interface Placed {
  readonly span: Span;
  readonly rendered: Rendered;
  /** The span's stored text before the edit. */
  readonly original: string;
  /** Where the rendered text starts in the edited LF view. */
  readonly at: number;
}

/** The edited text: the original between spans, each span's rendered replacement in its place. */
function assemble(
  view: TextView,
  spans: readonly Span[],
): { text: string; lf: string; placed: Placed[] } | { collision: Span } {
  const stored: string[] = [];
  const lf: string[] = [];
  const placed: Placed[] = [];
  let storedAt = 0;
  let lfAt = 0;
  let length = 0;
  let last: string | undefined;
  for (const [index, span] of spans.entries()) {
    const from = storedOffset(view, span.start);
    const to = storedOffset(view, span.end);
    const kept = view.text.slice(storedAt, from);
    stored.push(kept);
    lf.push(view.lf.slice(lfAt, span.start));
    length += span.start - lfAt;
    if (kept.length > 0) last = kept.at(-1);
    const next = spans[index + 1];
    const after = next !== undefined && next.start === span.end ? undefined : view.text[to];
    const original = view.text.slice(from, to);
    const text = { stored: original, lf: view.lf.slice(span.start, span.end) };
    const { oldText, newText } = span.edit;
    const rendered = renderReplacement(view, text, oldText, newText, span.fuzzy, {
      before: last,
      after,
    });
    if (rendered === 'collision') return { collision: span };
    placed.push({ span, rendered, original, at: length });
    stored.push(rendered.stored);
    lf.push(rendered.lf);
    length += rendered.lf.length;
    if (rendered.stored.length > 0) last = rendered.stored.at(-1);
    storedAt = to;
    lfAt = span.end;
  }
  stored.push(view.text.slice(storedAt));
  lf.push(view.lf.slice(lfAt));
  return { text: stored.join(''), lf: lf.join(''), placed };
}

/**
 * The lines of the edited file a replacement changed: its rendered lines, less those equal to the
 * replaced text's own first and last lines. A replacement that only removed lines names the line
 * now at the place of the removal.
 */
function changedLines(before: string, after: string, at: number, starts: Int32Array): LineRange {
  const old = before.split('\n');
  const written = after.split('\n');
  let head = 0;
  while (head < old.length && head < written.length && old[head] === written[head]) head += 1;
  let tail = 0;
  while (
    tail < old.length - head &&
    tail < written.length - head &&
    old[old.length - 1 - tail] === written[written.length - 1 - tail]
  )
    tail += 1;
  const line = lineAt(starts, at);
  const first = Math.min(line + head, starts.length);
  const last = Math.min(line + written.length - 1 - tail, starts.length);
  return { first, last: Math.max(first, last) };
}

function once<T>(make: () => T): () => T {
  let made: { value: T } | undefined;
  return () => (made ??= { value: make() }).value;
}
