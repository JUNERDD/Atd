/**
 * Highlighting of a `grep` call's pattern inside its matched lines. The pattern is model input run
 * by ripgrep (Rust regex syntax), and JavaScript re-runs it here only to mark what matched: any
 * pattern JavaScript cannot compile, or that risks catastrophic backtracking, simply leaves the
 * lines unmarked. The marks are a reading aid; the line itself is the match either way.
 */

/** Hard caps on pattern complexity so `grep` highlighting cannot stall the main thread. */
const MAX_PATTERN_LENGTH = 256;
const MAX_MARKS_PER_LINE = 64;
const MAX_GROUP_DEPTH = 16;
const MAX_QUANTIFIERS = 24;
const MAX_ALTERNATIONS = 16;

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

interface GroupFrame {
  hasQuantifier: boolean;
  hasAlternation: boolean;
  hasBackref: boolean;
}

/** Parses `{m}` / `{m,}` / `{m,n}` starting at `start`, returning the closing index and repeat capability. */
function parseBracedQuantifier(
  pattern: string,
  start: number,
): { end: number; repeatable: boolean } | null {
  const rest = pattern.slice(start);
  const match = /^\{(\d+)(?:,(\d*))?\}/.exec(rest);
  if (!match) return null;
  const min = Number(match[1]);
  const maxStr = match[2];
  // `{0}` or `{1}` matches at most once; `{m,}` or `{m,n}` with n > 1 (or single > 1) repeats.
  const max =
    maxStr === undefined ? min : maxStr === '' ? Number.POSITIVE_INFINITY : Number(maxStr);
  return { end: start + match[0].length - 1, repeatable: max > 1 };
}

/**
 * Depth-aware single-pass safety check for model-supplied regex patterns. Rejects nested
 * quantifiers at any group depth, quantified groups containing alternations or backreferences,
 * quantified backreferences, stacked quantifiers, and unbalanced groups/classes.
 */
function isSafeRegexPattern(pattern: string): boolean {
  const stack: GroupFrame[] = [{ hasQuantifier: false, hasAlternation: false, hasBackref: false }];
  let inClass = false;
  let classStart = -1;
  let lastToken: 'none' | 'atom' | 'group' | 'backref' | 'quantifier' = 'none';
  let lastGroup: GroupFrame | null = null;
  let quantifiers = 0;
  let alternations = 0;

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      if (i + 1 >= pattern.length) return false;
      const next = pattern[i + 1]!;
      if (!inClass && ((next >= '1' && next <= '9') || next === 'k')) {
        stack[stack.length - 1]!.hasBackref = true;
        lastToken = 'backref';
      } else {
        lastToken = 'atom';
      }
      i += 1;
      continue;
    }

    if (inClass) {
      if (ch === ']' && i > classStart) {
        inClass = false;
        lastToken = 'atom';
      }
      continue;
    }

    if (ch === '[') {
      inClass = true;
      classStart = pattern[i + 1] === '^' ? i + 2 : i + 1;
      lastToken = 'none';
      continue;
    }

    if (ch === '(') {
      if (stack.length >= MAX_GROUP_DEPTH) return false;
      stack.push({ hasQuantifier: false, hasAlternation: false, hasBackref: false });
      lastToken = 'none';
      // Skip group prefixes (`(?:`, `(?=`, `(?!`, `(?<=`, `(?<!`, `(?<name>`) so `?` is not
      // mistaken for a quantifier.
      if (pattern[i + 1] === '?') {
        i += 1;
        if (pattern[i + 1] === '<') {
          const look = pattern[i + 2];
          if (look === '=' || look === '!') {
            i += 2;
          } else {
            const close = pattern.indexOf('>', i + 2);
            if (close === -1) return false;
            i = close;
          }
        }
      }
      continue;
    }

    if (ch === ')') {
      if (stack.length <= 1) return false;
      const closed = stack.pop()!;
      const parent = stack[stack.length - 1]!;
      parent.hasQuantifier ||= closed.hasQuantifier;
      parent.hasAlternation ||= closed.hasAlternation;
      parent.hasBackref ||= closed.hasBackref;
      lastGroup = closed;
      lastToken = 'group';
      continue;
    }

    if (ch === '|') {
      alternations += 1;
      if (alternations > MAX_ALTERNATIONS) return false;
      stack[stack.length - 1]!.hasAlternation = true;
      lastToken = 'none';
      continue;
    }

    let braced: { end: number; repeatable: boolean } | null = null;
    if (ch === '{') {
      braced = parseBracedQuantifier(pattern, i);
      if (!braced) {
        lastToken = 'atom';
        continue;
      }
    }

    if (ch === '*' || ch === '+' || ch === '?' || braced) {
      if (lastToken === 'none' || lastToken === 'quantifier' || lastToken === 'backref') {
        return false;
      }
      const repeatable = braced ? braced.repeatable : ch !== '?';
      quantifiers += 1;
      if (quantifiers > MAX_QUANTIFIERS) return false;
      if (
        repeatable &&
        lastToken === 'group' &&
        lastGroup &&
        (lastGroup.hasQuantifier || lastGroup.hasAlternation || lastGroup.hasBackref)
      ) {
        return false;
      }
      stack[stack.length - 1]!.hasQuantifier = true;
      if (braced) i = braced.end;
      // Optional lazy modifier (`*?`, `+?`, `??`, `{m,n}?`) belongs to the same quantifier.
      if (pattern[i + 1] === '?') i += 1;
      lastToken = 'quantifier';
      continue;
    }

    lastToken = 'atom';
  }

  return !inClass && stack.length === 1;
}

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
  if (!literal && !isSafeRegexPattern(pattern)) return null;
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
