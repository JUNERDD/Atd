/** Helpers shared by the web tools' model text and error reporting. */

/** The first `max` characters of `value`. */
export function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** Collapses runs of whitespace; search snippets and titles are single-line. */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Message of an unknown failure, with Node's abort and timeout errors made readable. */
export function failure(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'The request timed out.';
    if (error.name === 'AbortError') return 'The request was aborted.';
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
    return `${error.message}${cause}`;
  }
  return String(error);
}

/** Throws the caller's abort instead of reporting it as a per-item failure. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('The operation was aborted.');
}
