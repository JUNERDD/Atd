import type { DiagLevel } from '../channel/diagnostics.ts';
import { buildDiagEvent, summarizeError } from '../diagnostics/sanitize.ts';
import type { ContentMessage } from '../messages/content.ts';

/**
 * Explicit catch-site diagnostic reporter for the content script.
 * NEVER attach unfiltered `window` `error` or `unhandledrejection` listeners in `src/content/`
 * (Chromium shares `Window` error events with the host webpage's main world).
 */
export type ContentDiagReporter = (
  level: DiagLevel,
  cat: string,
  code: string,
  errorOrMessage: unknown,
) => void;

export function createContentDiag(send: (message: ContentMessage) => void): ContentDiagReporter {
  return (level, cat, code, errorOrMessage) => {
    const msg =
      typeof errorOrMessage === 'string'
        ? errorOrMessage
        : summarizeError(errorOrMessage, `${cat}:${code}`);
    send(buildDiagEvent(level, cat, msg, code));
  };
}
