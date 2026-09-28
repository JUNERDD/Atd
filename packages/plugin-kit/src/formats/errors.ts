import type { PluginDiagnostic } from '../model/diagnostics.js';

/** The whole bundle is unusable; `diagnostics` explains why. */
export class InvalidPluginError extends Error {
  constructor(
    message: string,
    readonly diagnostics: PluginDiagnostic[],
  ) {
    super(message);
    this.name = 'InvalidPluginError';
  }
}

/** Rejects the bundle with one `invalid-manifest` error about `path`. */
export function invalidManifest(message: string, path?: string): InvalidPluginError {
  const diagnostic: PluginDiagnostic = { level: 'error', code: 'invalid-manifest', message };
  if (path !== undefined) diagnostic.path = path;
  return new InvalidPluginError(message, [diagnostic]);
}
