import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import {
  errorMessage,
  parse,
  RELAY_EPOCH_CURRENT_HEADER,
  RELAY_EPOCH_HEADER,
  RouteManifestEntrySchema,
  type ErrorEnvelope,
  type RouteManifestEntry,
  type RouteManifestResponse,
} from '@atd/agent-contracts';
import { authorize } from './auth.js';
import type { RouteExposure } from './route-exposure.js';

/**
 * Route options declaring an exposure (route-exposure.ts). Every route passes one of these, or its
 * own `config.exposure` beside other options, so its classification sits at its declaration.
 */
export const RENDERER_ROUTE = exposedAs('renderer');
export const SHELL_ROUTE = exposedAs('shell');

function exposedAs(exposure: RouteExposure) {
  return Object.freeze({ config: Object.freeze({ exposure }) });
}

/** A non-negative integer without sign, leading zeros or exponent; longer values are refused. */
const EPOCH_VALUE = /^(0|[1-9][0-9]{0,14})$/;

/**
 * What the macOS shell's relay relies on. Must run before any route is declared, since
 * `onRoute` only sees routes added after it:
 *
 * - Every route is recorded in the manifest as it is declared. A route without an exposure, or
 *   whose pattern the relay could not match segment by segment (a wildcard, a regex parameter),
 *   throws there, so the service fails to start instead of serving an unclassified route.
 * - `GET /v1/admin/routes` serves that manifest with the service epoch.
 * - A request carrying `x-relay-epoch` from another epoch is answered 409 before any handler
 *   runs, so the relay can refetch the manifest and safely replay even a POST.
 *
 * Fastify must be built with `exposeHeadRoutes: false`: every manifest entry is then a route the
 * service declared, and the relay never forwards a HEAD the renderer does not need.
 */
export function registerRelayRoutes(
  app: FastifyInstance,
  service: { epoch: number; token: string },
): void {
  const routes: RouteManifestEntry[] = [];
  app.addHook('onRoute', (route) => {
    routes.push(...manifestEntries(route));
  });
  app.addHook('onRequest', async (request, reply) => epochPrecondition(request, reply, service));
  app.get('/v1/admin/routes', SHELL_ROUTE, async (): Promise<RouteManifestResponse> => ({
    epoch: service.epoch,
    routes,
  }));
}

/** The manifest entries of one declared route, one per method; throws on an invalid route. */
function manifestEntries(route: RouteOptions): RouteManifestEntry[] {
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  const label = `${methods.join(',')} ${route.url}`;
  const exposure = route.config?.exposure;
  if (exposure === undefined)
    throw new Error(`Route ${label} declares no config.exposure ('renderer' or 'shell').`);
  if (route.url.includes('*'))
    throw new Error(
      `Route ${label} uses a wildcard; the relay matches one segment per :param, so wildcard routes cannot be classified.`,
    );
  return methods.map((method) => {
    try {
      return parse(RouteManifestEntrySchema, { method, pathPattern: route.url, exposure });
    } catch (error) {
      throw new Error(`Route ${label} cannot enter the route manifest: ${errorMessage(error)}`);
    }
  });
}

/**
 * Checks the relay's epoch precondition. Absent header: no check. A present header is answered
 * only for an authenticated caller, so the precondition never reveals the epoch to anyone else;
 * a malformed value is a 400, a stale one the 409 that alone carries `x-relay-epoch-current`.
 */
async function epochPrecondition(
  request: FastifyRequest,
  reply: FastifyReply,
  service: { epoch: number; token: string },
): Promise<FastifyReply | undefined> {
  const header = request.headers[RELAY_EPOCH_HEADER];
  if (header === undefined) return undefined;
  authorize(request, service.token);
  if (typeof header !== 'string' || !EPOCH_VALUE.test(header))
    throw new TypeError(`Invalid ${RELAY_EPOCH_HEADER} header: expected one integer epoch.`);
  if (Number(header) === service.epoch) return undefined;
  const body: ErrorEnvelope = {
    error: {
      code: 'epoch_mismatch',
      message: `The route manifest belongs to epoch ${header}; the service runs epoch ${service.epoch}.`,
    },
  };
  return reply.code(409).header(RELAY_EPOCH_CURRENT_HEADER, String(service.epoch)).send(body);
}
