import type { CommandSegment } from '../model/manifest.js';

/**
 * Parses a command body into segments. Argument segments are always 1-based.
 *
 * - `claude` (https://code.claude.com/docs/en/skills#available-string-substitutions): `$ARGUMENTS`,
 *   `$ARGUMENTS[N]` and `$N` with 0-based `N`, `$name` for declared `arguments`, and a single `\`
 *   before one of those placeholders escapes it (`\$1` is literal `$1`; `\\$1` keeps both
 *   backslashes and still expands). A backslash before any other `$` stays.
 * - `pi` (prompt-templates.md, `substituteArgs`): `$@` / `$ARGUMENTS`, 1-based `$N`,
 *   `${N:-default}`, `${@:-default}` and `${@:N[:L]}`. The segment model has no fallback or slice
 *   for "all arguments", so `${@:-default}` and `${@:N[:L]}` become a plain `arguments` segment.
 *
 * Anything else stays text. Adjacent text segments are merged.
 */
export function parseCommandTemplate(
  body: string,
  style: 'claude' | 'pi',
  declared: readonly string[],
): CommandSegment[] {
  const builder = new SegmentBuilder();
  if (style === 'claude') parseClaude(body, declared, builder);
  else parsePi(body, builder);
  return builder.segments;
}

class SegmentBuilder {
  readonly segments: CommandSegment[] = [];

  text(text: string): void {
    if (text === '') return;
    const last = this.segments.at(-1);
    if (last?.type === 'text') last.text += text;
    else this.segments.push({ type: 'text', text });
  }

  push(segment: Exclude<CommandSegment, { type: 'text' }>): void {
    this.segments.push(segment);
  }
}

type Placeholder = { length: number; segment: Exclude<CommandSegment, { type: 'text' }> };

/** Matches a Claude placeholder right after a `$` at `start`, or returns null. */
function matchClaude(body: string, start: number, declared: readonly string[]): Placeholder | null {
  const rest = body.slice(start);
  const indexed = /^ARGUMENTS\[(\d+)\]/.exec(rest);
  if (indexed?.[1] !== undefined) {
    return {
      length: indexed[0].length,
      segment: { type: 'argument', index: Number(indexed[1]) + 1 },
    };
  }
  if (rest.startsWith('ARGUMENTS')) return { length: 9, segment: { type: 'arguments' } };
  const name = declared
    .filter(
      (candidate) =>
        rest.startsWith(candidate) && !/^[A-Za-z0-9_]/.test(rest.slice(candidate.length)),
    )
    .sort((a, b) => b.length - a.length)[0];
  if (name !== undefined && name !== '') {
    return { length: name.length, segment: { type: 'named', name } };
  }
  const digits = /^\d+/.exec(rest);
  if (digits) {
    return {
      length: digits[0].length,
      segment: { type: 'argument', index: Number(digits[0]) + 1 },
    };
  }
  return null;
}

function parseClaude(body: string, declared: readonly string[], out: SegmentBuilder): void {
  let text = '';
  let index = 0;
  while (index < body.length) {
    const char = body[index];
    if (char === '\\' && body[index + 1] === '$' && body[index - 1] !== '\\') {
      const escaped = matchClaude(body, index + 2, declared);
      if (escaped) {
        text += body.slice(index + 1, index + 2 + escaped.length);
        index += 2 + escaped.length;
        continue;
      }
    }
    if (char === '$') {
      const placeholder = matchClaude(body, index + 1, declared);
      if (placeholder) {
        out.text(text);
        text = '';
        out.push(placeholder.segment);
        index += 1 + placeholder.length;
        continue;
      }
    }
    text += char;
    index += 1;
  }
  out.text(text);
}

/** pi's own expression, in pi's alternation order. */
const PI_PLACEHOLDER =
  /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g;

function parsePi(body: string, out: SegmentBuilder): void {
  let last = 0;
  for (const match of body.matchAll(PI_PLACEHOLDER)) {
    out.text(body.slice(last, match.index));
    last = match.index + match[0].length;
    const [, defaultTarget, defaultValue, sliceStart, , simple] = match;
    if (defaultTarget !== undefined) {
      if (defaultTarget === '@' || defaultTarget === 'ARGUMENTS') out.push({ type: 'arguments' });
      else if (Number(defaultTarget) >= 1) {
        out.push({ type: 'argument', index: Number(defaultTarget), fallback: defaultValue ?? '' });
      } else {
        // pi reads `${0:-x}` as args[-1], which is always missing, so the default always wins.
        out.text(defaultValue ?? '');
      }
    } else if (sliceStart !== undefined || simple === '@' || simple === 'ARGUMENTS') {
      out.push({ type: 'arguments' });
    } else if (simple !== undefined && Number(simple) >= 1) {
      out.push({ type: 'argument', index: Number(simple) });
    }
    // `$0` expands to an empty string in pi, so it contributes nothing.
  }
  out.text(body.slice(last));
}
