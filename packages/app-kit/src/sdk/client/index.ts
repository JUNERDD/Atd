/**
 * `@atd/app-kit/client`: what an app's page imports to reach its backend (same-origin `/api`,
 * which the shell forwards to the service) and the window's native features. Runtime errors are
 * reported by the script the shell injects, not by this SDK.
 */
import { createApi } from './api.ts';
import { subscribe } from './events.ts';

export {
  AppApiError,
  createApi,
  type ApiCallResult,
  type ApiInput,
  type ApiStreamChunk,
  type ApiStreamResult,
  type AppApi,
  type CallOptions,
} from './api.ts';
export { native, type PickedFile } from './native.ts';
export type { EventListener } from './events.ts';
export type { StreamHandle } from '../server/types.ts';

/** The untyped api; prefer `createApi<typeof backend>()` for checked names and inputs. */
export const api = createApi();
/** Backend event channels (`ctx.events.publish` on the server). */
export const events = { subscribe };
