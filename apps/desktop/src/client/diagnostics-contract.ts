/** Local support report export. Only a diagnostic build reports enabled. */
export interface DiagnosticsBridge {
  state(): Promise<{ enabled: boolean }>;
  export(): Promise<{ saved: boolean }>;
}
