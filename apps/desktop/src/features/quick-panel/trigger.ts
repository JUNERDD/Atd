interface SlashBase {
  kind: 'slash';
  /** The cursor. */
  to: number;
  /** Text after the trigger character. */
  query: string;
}

/** The quick-panel trigger under the cursor, as recognized by the composer editor. */
export type TriggerState =
  | (SlashBase & {
      /** At the start of the draft: quick commands and skills. */
      placement: 'leading';
      /** Always 0: the trigger text includes the leading whitespace. */
      from: number;
      /** `/model gpt` → `{ command: 'model', query: 'gpt' }` when `model` is drillable. */
      drill: { command: string; query: string } | null;
      /** The trigger character plus a full command id (`/model` in `/model 5.`), any case. */
      command: { id: string; from: number; to: number } | null;
    })
  | (SlashBase & {
      /** Anywhere else in the draft: skills only. */
      placement: 'inline';
      /** Offset of the `/`. */
      from: number;
      drill: null;
      command: null;
    })
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

/** Quick-command ids the editor recognizes after a leading `/`. */
export interface CommandIds {
  /** Every command id; a leading `/<id>` is reported as `command`. */
  all: readonly string[];
  /** The ids whose `/<id> <query>` drills into a second-level list. */
  drillable: readonly string[];
}

/**
 * A leading `/` opens at the start of a draft that begins with no chip. `／` and the `、` a Chinese
 * IME types for the `/` key are aliases there only; selecting normalizes them. A drillable command
 * followed by one space keeps the trigger open with a drill query on the same line.
 * `\uE000`/`\uE001` delimit chip tokens in the editor document.
 */
const LEADING_SLASH = /^(\s*)[/／、]([^\s\uE000\uE001]*)(?: ([^\n\uE000\uE001]*))?$/;
/**
 * pi-tui's token rule: a token starts at a line start or after whitespace, a quote, `=`, CJK
 * punctuation, or a chip, so e-mail addresses and URLs never open the panel.
 */
const TOKEN_START = /(?:^|[\s"'“”‘’=\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF1F\uE001])/;
/**
 * Only the ASCII `/` opens mid-draft: `、` separates Chinese list items. The query stops at the
 * next `/`, so a path such as `/Users/x` closes the panel at its second slash.
 */
const INLINE_SLASH = new RegExp(String.raw`${TOKEN_START.source}/([^\s/\uE000\uE001]*)$`);
const MENTION = new RegExp(String.raw`${TOKEN_START.source}[@＠]([^\s@＠\uE000\uE001]*)$`);

function leadingTrigger(context: TriggerContext, commands: CommandIds): TriggerState | null {
  const match = context.start === null ? null : LEADING_SLASH.exec(context.start);
  if (!match) return null;
  const from = match[1]?.length ?? 0;
  const typed = match[2] ?? '';
  const rest = match[3];
  const id = typed.toLowerCase();
  const command = commands.all.includes(id) ? { id, from, to: from + 1 + typed.length } : null;
  const trigger = {
    kind: 'slash',
    placement: 'leading',
    from: 0,
    to: context.head,
    command,
  } as const;
  if (rest === undefined) return { ...trigger, query: typed, drill: null };
  if (!commands.drillable.includes(id)) return null;
  return { ...trigger, query: `${typed} ${rest}`, drill: { command: id, query: rest } };
}

/** The trigger ending at the cursor. A leading `/` wins over an inline one, which wins over `@`. */
export function parseTrigger(context: TriggerContext, commands: CommandIds): TriggerState | null {
  const leading = leadingTrigger(context, commands);
  if (leading) return leading;
  const { head, line } = context;
  const inline = INLINE_SLASH.exec(line)?.[1];
  if (inline !== undefined) {
    const from = head - inline.length - 1;
    return {
      kind: 'slash',
      placement: 'inline',
      from,
      to: head,
      query: inline,
      drill: null,
      command: null,
    };
  }
  const mention = MENTION.exec(line)?.[1];
  if (mention === undefined) return null;
  return { kind: 'mention', from: head - mention.length - 1, to: head, query: mention };
}
