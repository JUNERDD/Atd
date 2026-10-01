/** A caught rejection's own message, or a generic one for a value that is not an Error. */
export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'The operation could not finish.';
}

const toastTextLimit = 80;

/**
 * Toast copy stays short: first sentence only, then a hard length cap. A sentence ends at a
 * terminator followed by a space or the end, so a file name (`notes.md could not be read.`) stays
 * whole.
 */
export function toastTextOf(error: unknown) {
  const message = (typeof error === 'string' ? error : messageOf(error))
    .replace(/\s+/g, ' ')
    .trim();
  const sentence = /^.*?[.!?](?= |$)/.exec(message)?.[0] ?? message;
  if (!sentence) return 'The operation could not finish.';
  return sentence.length > toastTextLimit
    ? `${sentence.slice(0, toastTextLimit - 1).trimEnd()}…`
    : sentence;
}
