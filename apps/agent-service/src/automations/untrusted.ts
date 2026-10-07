/**
 * Text an automation's run is given but nobody vetted: file and folder names from a watched
 * folder, another automation's answer, the previous answer. It goes into the prompt as data, so it
 * must not be able to look like structure there: every angle bracket (and its look-alikes) is
 * escaped, so no spelling of a tag can open or close a block, and invisible format characters
 * (zero-width, bidirectional controls) are dropped, so text cannot hide or reorder what it says.
 */

/** Angle brackets and their look-alikes, opening ones first in each pair. */
const OPENING = '<＜﹤‹〈⟨〈❬❮❰⧼';
const CLOSING = '>＞﹥›〉⟩〉❭❯❱⧽';
const BRACKETS = new RegExp(`[${OPENING}${CLOSING}]`, 'gu');

/** Multi-line untrusted text, with its structure-forming characters neutralized. */
export function inert(text: string): string {
  return text
    .replace(/\p{Cf}/gu, '')
    .replace(/\p{Cc}/gu, (char) => (char === '\n' || char === '\t' ? char : ' '))
    .replace(BRACKETS, (char) => (OPENING.includes(char) ? '&lt;' : '&gt;'));
}

/**
 * An untrusted name on one line, cut to `limit` characters: line breaks and other controls become
 * spaces, so a file name cannot start a line of its own wherever it is listed.
 */
export function oneLine(text: string, limit: number): string {
  const flat = inert(text)
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}
