import type { DiagnosticsBridge } from '../client/diagnostics-contract';
import type { NativeBridge, PostParams } from '../native-bridge/client';

type PageEvent = PostParams<'diagnostics.page'>;

/** Capture-phase facts establish whether WebKit got the click, without reading any page content. */
export function nativeDiagnostics(native: NativeBridge): DiagnosticsBridge {
  const state = native.call('diagnostics.state', {});
  void state.then(
    ({ enabled }) => {
      if (!enabled) return;
      function report(event: PageEvent['event'], source?: Event) {
        const target = source?.target;
        const kind: PageEvent['target'] =
          target instanceof HTMLInputElement
            ? 'input'
            : target instanceof HTMLTextAreaElement
              ? 'textarea'
              : target instanceof HTMLElement && target.closest('button')
                ? 'button'
                : target instanceof HTMLElement && target.closest('a')
                  ? 'link'
                  : target instanceof HTMLElement && target.isContentEditable
                    ? 'editable'
                    : 'other';
        native.post('diagnostics.page', {
          event,
          timestamp: performance.timeOrigin + performance.now(),
          hasFocus: document.hasFocus(),
          visible: document.visibilityState === 'visible',
          target: kind,
          x: source instanceof MouseEvent ? source.clientX : null,
          y: source instanceof MouseEvent ? source.clientY : null,
        });
      }
      for (const event of ['pointerdown', 'pointerup', 'click', 'visibilitychange'] as const) {
        document.addEventListener(event, (source) => report(event, source), {
          capture: true,
          passive: true,
        });
      }
      for (const event of ['focus', 'blur'] as const) {
        window.addEventListener(event, (source) => report(event, source), { passive: true });
      }
      report('ready');
    },
    () => {
      /* An older shell has no diagnostic endpoint. */
    },
  );
  return {
    state: () => native.call('diagnostics.state', {}),
    prepare: async () => {
      await native.call('diagnostics.prepare', {});
    },
    export: () => native.call('diagnostics.export', {}),
  };
}
