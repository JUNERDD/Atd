/** Removes Electron's IPC wrapper so caught rejections carry only their own message. */
export function messageOf(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : 'The operation could not finish.';
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
