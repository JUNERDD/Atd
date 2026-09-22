import { realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * T5 required child extension registration. The bridge is a REAL file path
 * loaded into every foreground child; parent startup fails closed without an
 * identity or when the module file is missing. No ambient trust escalation.
 */

export const REQUIRED_EXTENSION_ID = 'service.child-bridge';

export async function resolveRequiredExtensionPath(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, 'child-bridge.js'),
    path.join(here, 'child-bridge.ts'),
    path.join(here, '..', '..', 'dist', 'subagents', 'child-bridge.js'),
  ];
  // Prefer the compiled sibling when the service runs from dist; fall back to
  // the source sibling for tsx/dev. Every candidate must be a real file.
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return await realpath(candidate);
    } catch {
      continue;
    }
  }
  throw new Error('Required child extension is missing: no child-bridge module file exists.');
}

/** Loads `registerRequiredChildExtensions` from the direct dependency. */
export async function loadRequiredExtensionRegistrar(): Promise<{
  registerRequiredChildExtensions(input: {
    sessionId: string;
    extensions: readonly { id: string; path: string }[];
  }): { dispose(): void };
}> {
  try {
    return (await import('pi-subagents/required-child-extensions')) as {
      registerRequiredChildExtensions(input: {
        sessionId: string;
        extensions: readonly { id: string; path: string }[];
      }): { dispose(): void };
    };
  } catch {
    const require = createRequire(import.meta.url);
    const root = path.dirname(require.resolve('pi-subagents'));
    const { pathToFileURL: toUrl } = await import('node:url');
    return (await import(
      toUrl(path.join(root, 'src', 'api', 'required-child-extensions.js')).href
    )) as {
      registerRequiredChildExtensions(input: {
        sessionId: string;
        extensions: readonly { id: string; path: string }[];
      }): { dispose(): void };
    };
  }
}

/** Registers the bridge for one parent session; fails without identity. */
export async function registerRequiredBridge(input: {
  sessionId: string;
  taskId: string;
  runId: string;
}): Promise<{ dispose(): void; path: string }> {
  if (!input.sessionId || !input.taskId || !input.runId)
    throw new Error('Required child extension needs root/task/session identity.');
  const extensionPath = await resolveRequiredExtensionPath();
  const { registerRequiredChildExtensions } = await loadRequiredExtensionRegistrar();
  const handle = registerRequiredChildExtensions({
    sessionId: input.sessionId,
    extensions: [{ id: REQUIRED_EXTENSION_ID, path: extensionPath }],
  });
  return { dispose: () => handle.dispose(), path: extensionPath };
}
