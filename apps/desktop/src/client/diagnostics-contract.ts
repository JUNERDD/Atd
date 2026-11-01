/** Local support report export. Only a diagnostic build reports enabled. */
export interface DiagnosticsBridge {
  state(): Promise<{ enabled: boolean; accessibilityTrusted: boolean; mouseTapActive: boolean }>;
  prepare(): Promise<void>;
  export(): Promise<{ saved: boolean }>;
}
