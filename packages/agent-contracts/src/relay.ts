import { Type, type Static } from 'typebox';

/**
 * Request header carrying the service epoch the relay's route manifest came from. When present
 * and different from the running service's epoch, the service answers 409 `epoch_mismatch` before
 * any handler runs, so the relay can refetch the manifest and replay the request once. Direct
 * clients (the Swift shell's own calls, the CLI) omit it and are never checked.
 */
export const RELAY_EPOCH_HEADER = 'x-relay-epoch';

/**
 * Response header carrying the running service's epoch. Only the `epoch_mismatch` 409 sets it,
 * which tells that 409 apart from the business conflicts other routes answer with 409.
 */
export const RELAY_EPOCH_CURRENT_HEADER = 'x-relay-epoch-current';

/**
 * Who may reach a route: `renderer` routes are relayed for the WebView, `shell` routes answer
 * only direct main-token clients. Mirrors `RouteExposure` in the service's route config.
 */
export const RouteExposureSchema = Type.Union([Type.Literal('renderer'), Type.Literal('shell')]);

export const RouteMethodSchema = Type.Union([
  Type.Literal('GET'),
  Type.Literal('POST'),
  Type.Literal('PUT'),
  Type.Literal('PATCH'),
  Type.Literal('DELETE'),
]);
export type RouteMethod = Static<typeof RouteMethodSchema>;

/**
 * One route as the relay matches it. `pathPattern` is the Fastify route URL: literal segments and
 * `:name` parameters, each parameter matching exactly one non-empty path segment. Wildcards,
 * regex parameters and multi-parameter segments never appear.
 */
export const RouteManifestEntrySchema = Type.Object(
  {
    method: RouteMethodSchema,
    pathPattern: Type.String({
      maxLength: 512,
      pattern: '^(/([A-Za-z0-9._~-]+|:[A-Za-z_][A-Za-z0-9_]*))+$',
    }),
    exposure: RouteExposureSchema,
  },
  { additionalProperties: false },
);
export type RouteManifestEntry = Static<typeof RouteManifestEntrySchema>;

/**
 * `GET /v1/admin/routes` (shell, main token only): every route the running service serves and the
 * service epoch it belongs to, which the relay sends back as `x-relay-epoch`.
 */
export const RouteManifestResponseSchema = Type.Object(
  {
    epoch: Type.Integer({ minimum: 0 }),
    routes: Type.Array(RouteManifestEntrySchema),
  },
  { additionalProperties: false },
);
export type RouteManifestResponse = Static<typeof RouteManifestResponseSchema>;
