/**
 * Highlighting of a `grep` call's pattern inside its matched lines. The pattern is model input run
 * by ripgrep (Rust regex syntax), and JavaScript re-runs it here only to mark what matched: any
 * pattern JavaScript cannot compile, or that risks catastrophic backtracking, simply leaves the
 * lines unmarked. The marks are a reading aid; the line itself is the match either way.
 */

/** Longer patterns are not re-run; ripgrep already did the search. */
const MAX_PATTERN_LENGTH = 256;
/** Marks per line; Pi truncates each line to 500 characters, so this bounds the work too. */
const MAX_MARKS_PER_LINE = 64;
/**
 * A quantified group that itself contains a quantifier (`(a+)+`, `(\w*x)*`, `(a|b+){2,}`): the
 * shape behind exponential backtracking, which ripgrep's automaton never suffers but JavaScript's
 * engine does. Such patterns are not highlighted.
 */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[*+}](?:[^()\\]|\\.)*\)[*+{]/;

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** A slice of a line: `match` marks an occurrence of the searched pattern. */
export interface Segment {
  text: string;
  match: boolean;
}

/**
 * The global regex that finds the call's pattern, honoring `literal` and `ignoreCase` the way
 * Pi passes them to ripgrep, or `null` when the pattern cannot be applied safely.
 */
export function grepMatcher(args: Record<string, unknown>): RegExp | null {
  const pattern = args.pattern;
  if (typeof pattern !== 'string' || pattern === '' || pattern.length > MAX_PATTERN_LENGTH)
    return null;
  const literal = args.literal === true;
  if (!literal && NESTED_QUANTIFIER.test(pattern)) return null;
  const source = literal ? pattern.replace(REGEX_SPECIALS, '\\$&') : pattern;
  const flags = args.ignoreCase === true ? 'gi' : 'g';
  // Unicode mode first, closer to ripgrep (`\p{…}`, code points); plain mode accepts escapes
  // that Unicode mode rejects (`\-`, `\/`).
  for (const mode of ['u', '']) {
    try {
      return new RegExp(source, flags + mode);
    } catch {
      // Not valid in this mode; try the next, then give up.
    }
  }
  return null;
}

/**
 * `text` split into plain and matched segments. Empty matches are skipped, and the line stays
 * whole when nothing matches or the matcher is `null`.
 */
export function highlightSegments(text: string, matcher: RegExp | null): Segment[] {
  if (!matcher) return [{ text, match: false }];
  const regex = new RegExp(matcher.source, matcher.flags);
  const segments: Segment[] = [];
  let cursor = 0;
  let marks = 0;
  for (
    let found = regex.exec(text);
    found && marks < MAX_MARKS_PER_LINE;
    found = regex.exec(text)
  ) {
    const value = found[0];
    if (value === '') {
      regex.lastIndex += 1;
      continue;
    }
    if (found.index > cursor)
      segments.push({ text: text.slice(cursor, found.index), match: false });
    segments.push({ text: value, match: true });
    cursor = found.index + value.length;
    marks += 1;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments.length > 0 ? segments : [{ text, match: false }];
}
