/** Local support report export. Only a diagnostic build reports enabled. */
export interface DiagnosticsBridge {
  state(): Promise<{
    enabled: boolean;
    focusEnabled: boolean;
    recording: boolean;
    accessibilityTrusted: boolean;
    mouseTapActive: boolean;
  }>;
  prepare(): Promise<void>;
  start(): Promise<void>;
  export(): Promise<{ saved: boolean; cleanupFailed: boolean }>;
  onRecording(listener: (recording: boolean) => void): () => void;
}
