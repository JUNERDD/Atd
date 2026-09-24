import { Type, type Static } from 'typebox';

/**
 * Shell allowlist shared by the desktop settings store (the user list), the service ShellPolicy
 * (user list ∪ `AI_AGENT_SHELL_ALLOWLIST`) and the renderer's validation. One module owns the
 * entry format and the matching rule so the three sides cannot disagree about what an entry
 * allows.
 */

export const SHELL_ALLOWLIST_MAX_ENTRIES = 100;
export const SHELL_ALLOWLIST_ENTRY_MAX_LENGTH = 200;

/**
 * One allowlist entry: whitespace-separated tokens of a restricted charset, single spaces between
 * tokens, no leading `-`. The charset has no quotes, escapes, substitutions, redirections or
 * separators, so an entry can only name a program and its leading plain arguments.
 */
export const SHELL_ALLOWLIST_ENTRY_PATTERN =
  '^[A-Za-z0-9._/:=@+,%~][A-Za-z0-9._/:=@+,%~-]*( [A-Za-z0-9._/:=@+,%~-]+)*$';

export const ShellAllowlistEntrySchema = Type.String({
  minLength: 1,
  maxLength: SHELL_ALLOWLIST_ENTRY_MAX_LENGTH,
  pattern: SHELL_ALLOWLIST_ENTRY_PATTERN,
});

export const ShellAllowlistSchema = Type.Array(ShellAllowlistEntrySchema, {
  maxItems: SHELL_ALLOWLIST_MAX_ENTRIES,
  uniqueItems: true,
});

/** Main → service: the full user list, replacing the previous one (`PUT /v1/settings/shell-allowlist`). */
export const PutShellAllowlistRequestSchema = Type.Object(
  { entries: ShellAllowlistSchema },
  { additionalProperties: false },
);
export type PutShellAllowlistRequest = Static<typeof PutShellAllowlistRequestSchema>;

/** The user list the service now holds; the operator env list is never echoed. */
export const PutShellAllowlistResponseSchema = Type.Object(
  { entries: ShellAllowlistSchema },
  { additionalProperties: false },
);
export type PutShellAllowlistResponse = Static<typeof PutShellAllowlistResponseSchema>;

/** Why an entry cannot be added; the settings UI maps each code to its own message. */
export type ShellAllowlistEntryError = 'empty' | 'tooLong' | 'invalid' | 'duplicate' | 'limit';

/**
 * Characters that chain, substitute, group, escape or redirect in a POSIX shell. A command that
 * contains any of them is never allowlisted and never gets a suggested entry, even when quoted:
 * the approval then comes from the confirm instead of a prefix match.
 */
const SHELL_CONTROL = /[;&|`$<>(){}\\\n\r]/;
const ENTRY = new RegExp(SHELL_ALLOWLIST_ENTRY_PATTERN);
/** A second token that reads as a subcommand (`npm test`, `git status`), not a flag or path. */
const SUBCOMMAND = /^[A-Za-z][A-Za-z0-9._:-]*$/;

function collapse(value: string): string {
  return value.trim().replace(/[ \t]+/g, ' ');
}

/** Trims and collapses spaces/tabs; answers the entry, or why it is not a valid entry. */
export function normalizeShellAllowlistEntry(
  value: string,
): { entry: string } | { error: Exclude<ShellAllowlistEntryError, 'duplicate' | 'limit'> } {
  const entry = collapse(value);
  if (!entry) return { error: 'empty' };
  if (entry.length > SHELL_ALLOWLIST_ENTRY_MAX_LENGTH) return { error: 'tooLong' };
  return ENTRY.test(entry) ? { entry } : { error: 'invalid' };
}

/**
 * Whether `command` runs without a confirm under `entries`. Matching is on token boundaries of
 * the trimmed, space-collapsed command: equal to an entry, or starting with the entry plus a
 * space (`git` allows `git status`, never `gitx`). Commands containing shell control characters
 * never match.
 */
export function isShellAllowlisted(entries: readonly string[], command: string): boolean {
  if (SHELL_CONTROL.test(command)) return false;
  const normalized = collapse(command);
  if (!normalized) return false;
  return entries.some((entry) => normalized === entry || normalized.startsWith(`${entry} `));
}

/**
 * The entry the bash confirm offers to add: the program plus a subcommand-like second token
 * (`npm test --watch` → `npm test`, `ls -la` → `ls`). `null` when the command has shell control
 * characters or its tokens are outside the entry charset, in which case the confirm offers no
 * add-to-allowlist choice.
 */
export function suggestShellAllowlistEntry(command: string): string | null {
  if (SHELL_CONTROL.test(command)) return null;
  const [program, second] = collapse(command).split(' ');
  if (!program) return null;
  const candidate = second && SUBCOMMAND.test(second) ? `${program} ${second}` : program;
  const result = normalizeShellAllowlistEntry(candidate);
  return 'entry' in result ? result.entry : null;
}
