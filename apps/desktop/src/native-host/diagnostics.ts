import type { DiagnosticsBridge, LiveProbeEvent } from '../client/diagnostics-contract';
import { runDoctorChecks } from '../client/diagnostics-client';
import {
  BREADCRUMB_MAX_TOTAL_BYTES,
  diagnosticsBreadcrumbs,
  recordNormalizedError,
} from '../features/diagnostics/breadcrumbs';
import type { NativeBridge } from '../native-bridge/client';
import type { NativeConnection } from './native-connection';

const NOISY_DIAGNOSTICS_CHANNELS = new Set([
  'transcript.patch',
  'child.transcript.patch',
  'queue.update',
  'context.update',
  'computer.progress',
  'socket.frames',
  'socket.send',
  'bridge.ready',
  'diagnostics.liveProbe.event',
]);

declare global {
  interface Window {
    /** Called by Swift's `WebViewHost+Diagnostics` with a 1s timeout during support-bundle export. */
    __atdReadDiagnosticsBreadcrumbsJson?: () => string;
  }
}

let disposeGlobalCapture: (() => void) | null = null;

function isNoisyBridgeChannel(text: string): boolean {
  for (const channel of NOISY_DIAGNOSTICS_CHANNELS) {
    if (text.includes(channel)) return true;
  }
  return false;
}

/**
 * Installs global renderer error/rejection/bridge-drop capture and exposes the bounded
 * `window.__atdReadDiagnosticsBreadcrumbsJson` getter (`<= 131_072` chars).
 */
export function installDiagnosticsCapture(): () => void {
  disposeGlobalCapture?.();

  window.__atdReadDiagnosticsBreadcrumbsJson = () =>
    diagnosticsBreadcrumbs.readSerializedJson(BREADCRUMB_MAX_TOTAL_BYTES);

  const onError = (event: ErrorEvent) => {
    if (event.error !== undefined && event.error !== null) {
      recordNormalizedError('unhandled_error', event.error);
      return;
    }
    diagnosticsBreadcrumbs.record({
      category: 'unhandled_error',
      code: null,
      name: 'ErrorEvent',
      message: event.message || 'Unhandled window error',
    });
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    recordNormalizedError('unhandled_rejection', event.reason);
  };

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const first = typeof args[0] === 'string' ? args[0] : '';
    if (
      (first.startsWith('Dropped a message from the native shell:') ||
        (first.startsWith('A ') && first.includes(' listener failed:'))) &&
      !isNoisyBridgeChannel(first)
    ) {
      recordNormalizedError('bridge_drop', args[1] ?? first, 'bridge_drop');
    }
    originalConsoleError.apply(console, args);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  const dispose = () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    if (console.error !== originalConsoleError) {
      console.error = originalConsoleError;
    }
    if (disposeGlobalCapture === dispose) disposeGlobalCapture = null;
  };
  disposeGlobalCapture = dispose;
  return dispose;
}

/** Subscribes to Swift `diagnostics.liveProbe.event` pushes through the typed bridge. */
export function subscribeLiveProbeEvent(
  native: NativeBridge,
  listener: (event: LiveProbeEvent) => void,
): () => void {
  return native.on('diagnostics.liveProbe.event', listener);
}

/** Installs renderer diagnostics capture and builds the `window.desktop.diagnostics` bridge. */
export function installHostDiagnostics(
  native: NativeBridge,
  connection: NativeConnection,
): DiagnosticsBridge {
  const dispose = installDiagnosticsCapture();
  import.meta.hot?.dispose(dispose);
  return {
    runDoctor: (includeConnectivity = false) =>
      runDoctorChecks(connection.options(), { includeConnectivity }),
    shellReport: () => native.call('diagnostics.shellReport', {}),
    startLiveProbe: (kind) => native.call('diagnostics.liveProbe.start', { kind }),
    stopLiveProbe: async () => void (await native.call('diagnostics.liveProbe.stop', {})),
    onLiveProbeEvent: (listener) => subscribeLiveProbeEvent(native, listener),
    previewBundle: (includeCrashSummaries) =>
      native.call('diagnostics.previewBundle', {
        rendererBreadcrumbs: diagnosticsBreadcrumbs.snapshot(),
        includeCrashSummaries,
      }),
    exportBundle: (includeCrashSummaries) =>
      native.call('diagnostics.exportBundle', {
        rendererBreadcrumbs: diagnosticsBreadcrumbs.snapshot(),
        includeCrashSummaries,
      }),
    restartService: () => native.call('diagnostics.restartService', {}),
  };
}
