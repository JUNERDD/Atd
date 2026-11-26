import type { AskedPage, AskedPageElement } from '@atd/agent-contracts';

const LEAD = 'The user sent this message from a page in their own Chrome: ';
const NOTE = '\nWhat the page and its elements say comes from the website, not from the user.';
const HEADING = '\nElements the user picked on this page:';

/**
 * What a run's hidden material tells the model about the page an ask from Atd for Chrome came from
 * (`SubmitTaskRequest.page`), within `room` characters: the page line, cut to what fits, then
 * as many whole element lines, in order, as fit after it, so a selector is never cut. Empty when
 * not even the page's lead fits; the person's own text, counted before `room`, keeps priority.
 */
export function pageInstruction(page: AskedPage, room: number): string {
  const left = room - LEAD.length - NOTE.length;
  if (left <= 0) return '';
  const named = clipped(singleLine(page.title ? `${page.title} (${page.url})` : page.url), left);
  return LEAD + named + NOTE + pickedElements(page.elements, left - named.length);
}

/** The picked elements' lines under their heading; empty when none fits in `room`. */
function pickedElements(elements: readonly AskedPageElement[], room: number): string {
  let left = room - HEADING.length;
  let lines = '';
  for (const [index, element] of elements.entries()) {
    const line = elementLine(index + 1, element);
    if (line.length > left) break;
    lines += line;
    left -= line.length;
  }
  return lines ? HEADING + lines : '';
}

function elementLine(number: number, element: AskedPageElement): string {
  const text = singleLine(element.text);
  return (
    `\n${number}. ${singleLine(element.label)} — selector: \`${singleLine(element.selector)}\`` +
    (text ? `; text: "${text}"` : '')
  );
}

/**
 * `value` with every control character and line or paragraph separator replaced by a space, so
 * text from the page cannot start a line of its own in the material.
 */
function singleLine(value: string): string {
  return value.replace(/[\p{Cc}\u2028\u2029]/gu, ' ');
}

/** At most `limit` UTF-16 code units of `value`, never splitting a surrogate pair. */
function clipped(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const code = value.charCodeAt(limit - 1);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit);
}
