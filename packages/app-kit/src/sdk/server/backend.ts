import type { ApiMap, BackendDefinition } from './types.ts';

/**
 * Declares the app's backend: `server/index.ts` default-exports the result. The runtime calls
 * `onStart` once per process (migrate the database idempotently there: a reverted version runs
 * against data a newer version wrote), serves `api` calls from the page, renders `widgets`, and
 * calls `onStop` before the process exits.
 */
export function defineBackend<Api extends ApiMap>(
  definition: BackendDefinition<Api>,
): BackendDefinition<Api> {
  return definition;
}
