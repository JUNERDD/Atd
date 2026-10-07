import type { FastifyReply } from 'fastify';
import { errorMessage, type AppError } from '@atd/agent-contracts';

/**
 * A failure of the apps feature with the HTTP status and code it answers with. `code` is a
 * service error code (`protocol.ts`) for failures the service raises, or the code an app backend
 * threw (`app_error`, `not_found`, `cancelled`…), which the app's page reads from the envelope.
 * Routes answer these themselves (`sendAppFailure`); anything else reaches the server's handler.
 */
export class AppFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppFailure';
  }

  toWire(): AppError {
    return { code: this.code, message: this.message.slice(0, 4000) };
  }
}

export const appNotFound = (appId: string) =>
  new AppFailure(404, 'app_not_found', `No app has the id ${appId}.`);

export const backendUnavailable = (message: string) =>
  new AppFailure(503, 'app_backend_unavailable', message);

export const capabilityDenied = (message: string) =>
  new AppFailure(403, 'app_capability_denied', message);

export const buildFailed = (message: string) => new AppFailure(422, 'app_build_failed', message);

/**
 * Statuses of the codes a backend's answer can carry: its own (`not_found`, `cancelled`,
 * `payload_too_large`) and the service's that a failed capability request passed through it.
 */
const BACKEND_STATUS: ReadonlyMap<string, number> = new Map([
  ['not_found', 404],
  ['payload_too_large', 413],
  ['cancelled', 499],
  ['app_capability_denied', 403],
  ['app_backend_unavailable', 503],
  ['auth_required', 409],
  ['upstream_failed', 502],
  ['not_implemented', 501],
]);

/** The HTTP status of an error code an app backend answered with; app errors are 422. */
export function backendErrorStatus(code: string): number {
  return BACKEND_STATUS.get(code) ?? 422;
}

/** A failure from a backend's `{code, message}`. */
export function fromBackendError(error: AppError): AppFailure {
  return new AppFailure(backendErrorStatus(error.code), error.code, error.message);
}

/** The `{code, message}` of anything thrown, for IPC replies and stream lines. */
export function toAppError(error: unknown, fallback = 'internal'): AppError {
  if (error instanceof AppFailure) return error.toWire();
  return { code: fallback, message: errorMessage(error).slice(0, 4000) };
}

/**
 * Wraps a route handler so an `AppFailure` answers with its own status and envelope; other
 * errors keep going to the server's error handler.
 */
export function appRoute<A extends unknown[], R>(
  handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<R | FastifyReply> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (error) {
      const reply = args.find(isReply);
      if (error instanceof AppFailure && reply)
        return reply.status(error.status).send({ error: error.toWire() });
      throw error;
    }
  };
}

function isReply(value: unknown): value is FastifyReply {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'send' in value &&
    'hijack' in value
  );
}
