/** Local support report export. Only a diagnostic build reports enabled. */
export interface DiagnosticsBridge {
  state(): Promise<{
    enabled: boolean;
    focusEnabled: boolean;
    recording: boolean;
    cleanupFailed: boolean;
    /** Native-owned wall deadline in Unix seconds; null while stopped. */
    expiresAt: number | null;
    accessibilityTrusted: boolean;
    mouseTapActive: boolean;
  }>;
  prepare(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<{ cleanupFailed: boolean }>;
  export(): Promise<{ saved: boolean; cleanupFailed: boolean }>;
  onRecording(listener: (recording: boolean) => void): () => void;
}
