/** The quick-panel trigger under the cursor, as recognized by the composer editor. */
export type TriggerState =
  | {
      kind: 'slash';
      /** Document offset where the trigger text starts (leading whitespace included). */
      from: number;
      /** The cursor. */
      to: number;
      /** Text after the trigger character. */
      query: string;
      /** `/model gpt` → `{ command: 'model', query: 'gpt' }` when `model` is drillable. */
      drill: { command: string; query: string } | null;
    }
  | { kind: 'mention'; from: number; to: number; query: string };

/** Text before an empty cursor, as the editor reads it. */
export interface TriggerContext {
  /** Cursor offset. */
  head: number;
  /** Document text from 0 to the cursor, or null when too long to be a slash command. */
  start: string | null;
  /** Current line up to the cursor. */
  line: string;
}

/**
 * `/` only opens at the start of a draft that begins with no chip. `／` and the `、` a Chinese IME
 * types for the `/` key are aliases there; selecting normalizes them. A drillable command followed
 * by one space keeps the trigger open with a drill query on the same line. `\uE000`/`\uE001`
 * delimit chip tokens in the editor document.
 */
const SLASH = /^\s*[/／、]([^\s\uE000\uE001]*)(?: ([^\n\uE000\uE001]*))?$/;
/**
 * pi-tui's token rule: `@` (or `＠`) at a line start or after whitespace, a quote, `=`, CJK
 * punctuation, or a chip, with no whitespace up to the cursor, so e-mail addresses and URLs never
 * open the panel.
 */
const MENTION =
  /(?:^|[\s"'“”‘’=\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF1F\uE001])[@＠]([^\s@＠\uE000\uE001]*)$/;

export function parseTrigger(
  context: TriggerContext,
  drillable: readonly string[],
): TriggerState | null {
  const slash = context.start === null ? null : SLASH.exec(context.start);
  if (slash) {
    const command = slash[1] ?? '';
    const rest = slash[2];
    if (rest === undefined)
      return { kind: 'slash', from: 0, to: context.head, query: command, drill: null };
    const drill = drillable.find((id) => id === command.toLowerCase());
    if (drill)
      return {
        kind: 'slash',
        from: 0,
        to: context.head,
        query: `${command} ${rest}`,
        drill: { command: drill, query: rest },
      };
  }
  const mention = MENTION.exec(context.line);
  if (!mention) return null;
  const query = mention[1] ?? '';
  return {
    kind: 'mention',
    from: context.head - query.length - 1,
    to: context.head,
    query,
  };
}
