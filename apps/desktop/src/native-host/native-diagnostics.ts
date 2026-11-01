import type { DiagnosticsBridge } from '../client/diagnostics-contract';
import type { NativeBridge, PostParams } from '../native-bridge/client';

type PageEvent = PostParams<'diagnostics.page'>;
type DiagnosticState = Awaited<ReturnType<DiagnosticsBridge['state']>>;

/** Capture-phase facts establish whether WebKit got the click, without reading page content. */
function recordPage(native: NativeBridge, focusEnabled: boolean): () => void {
  const abort = new AbortController();
  function report(event: PageEvent['event'], source?: Event, elapsed: number | null = null) {
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
      width: window.innerWidth,
      height: window.innerHeight,
      elapsed,
      hasFocus: document.hasFocus(),
      visible: document.visibilityState === 'visible',
      target: kind,
      x: source instanceof MouseEvent ? source.clientX : null,
      y: source instanceof MouseEvent ? source.clientY : null,
    });
  }
  const pageEvents = focusEnabled
    ? (['pointerdown', 'pointerup', 'click', 'visibilitychange'] as const)
    : (['visibilitychange'] as const);
  for (const event of pageEvents) {
    document.addEventListener(event, (source) => report(event, source), {
      capture: true,
      passive: true,
      signal: abort.signal,
    });
  }
  for (const event of ['focus', 'blur', 'error', 'unhandledrejection', 'resize'] as const) {
    window.addEventListener(event, (source) => report(event, source), {
      passive: true,
      signal: abort.signal,
    });
  }
  let lastHeartbeat = performance.now();
  const heartbeat = window.setInterval(() => {
    const now = performance.now();
    report('heartbeat', undefined, now - lastHeartbeat);
    lastHeartbeat = now;
  }, 5000);
  report('ready');
  return () => {
    abort.abort();
    window.clearInterval(heartbeat);
  };
}

/** Native owns persistence; only its recording state starts or stops page collection. */
export function nativeDiagnostics(native: NativeBridge): DiagnosticsBridge {
  let capabilities: DiagnosticState | undefined;
  let recording: boolean | undefined;
  let revision = 0;
  let disposed = false;
  let detach: (() => void) | undefined;
  const listeners = new Set<(recording: boolean) => void>();
  function syncRecorder() {
    if (!disposed && capabilities?.enabled && recording) {
      detach ??= recordPage(native, capabilities.focusEnabled);
    } else {
      detach?.();
      detach = undefined;
    }
  }
  function updateRecording(next: boolean) {
    const changed = recording !== next;
    recording = next;
    syncRecorder();
    if (changed) for (const listener of listeners) listener(next);
  }
  // Subscribe before querying: a late state reply must not undo a stop/start event.
  const unsubscribe = native.on('diagnostics.recording', ({ recording: next }) => {
    revision++;
    updateRecording(next);
  });
  async function state(): Promise<DiagnosticState> {
    const requestedAt = revision;
    const next = await native.call('diagnostics.state', {});
    capabilities = next;
    if (requestedAt === revision) updateRecording(next.recording);
    else syncRecorder();
    return { ...next, recording: recording ?? next.recording };
  }
  void state().catch(() => {
    /* An older shell has no diagnostic endpoint. */
  });
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      unsubscribe();
      syncRecorder();
      listeners.clear();
    },
    { once: true },
  );
  return {
    state,
    prepare: async () => {
      await native.call('diagnostics.prepare', {});
    },
    start: async () => {
      await native.call('diagnostics.start', {});
    },
    export: () => native.call('diagnostics.export', {}),
    onRecording(listener) {
      listeners.add(listener);
      if (recording !== undefined) listener(recording);
      return () => listeners.delete(listener);
    },
  };
}
