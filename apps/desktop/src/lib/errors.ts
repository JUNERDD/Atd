import {
  recordNormalizedError,
  type BreadcrumbCategory,
} from '../features/diagnostics/breadcrumbs';

/** A caught rejection's own message, or a generic one for a value that is not an Error. */
export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'The operation could not finish.';
}

const toastTextLimit = 80;

const DIAGNOSABLE_CODES = new Set([
  'internal',
  'service_starting',
  'service_start_failed',
  'service_stopped_too_often',
  'service_not_running',
  'desktop_unavailable',
]);

/** Returns true when an error indicates service disconnection, 500/503 failure, or bridge refusal. */
export function isDiagnosableError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.code === 'string' && DIAGNOSABLE_CODES.has(record.code)) return true;
    if (record.status === 500 || record.status === 503) return true;
  }
  const text = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  return /service.*(disconnected|not available|not running|unavailable)|native shell|bridge|request failed with status 50[03]/i.test(
    text,
  );
}

/** Records a detached `<= 320`-char normalized breadcrumb before toast truncation runs. */
export function recordErrorBreadcrumb(
  category: Exclude<BreadcrumbCategory, 'stream_state'>,
  error: unknown,
  fallbackCode: string | null = null,
): void {
  recordNormalizedError(category, error, fallbackCode);
}

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
