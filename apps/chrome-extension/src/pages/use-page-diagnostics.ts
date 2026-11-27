import { useEffect } from 'react';
import { buildDiagEvent, summarizeError, type DiagEventPayload } from '../diagnostics/sanitize.ts';

/**
 * Captures uncaught `error` and `unhandledrejection` events in extension UI pages (panel and
 * options, which run on `chrome-extension://` origins isolated from webpages) and forwards them
 * to the service worker over the page's existing port.
 */
export function usePageDiagnostics(send: (message: DiagEventPayload) => void): void {
  useEffect(() => {
    const onError = (event: ErrorEvent): void => {
      send(
        buildDiagEvent(
          'error',
          'runtime',
          summarizeError(event.error ?? event.message, 'Uncaught page error'),
          'uncaught_error',
        ),
      );
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
      send(
        buildDiagEvent(
          'error',
          'runtime',
          summarizeError(event.reason, 'Unhandled page rejection'),
          'unhandled_rejection',
        ),
      );
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [send]);
}
