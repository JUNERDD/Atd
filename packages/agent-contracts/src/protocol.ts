import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/**
 * Why a compaction request was refused (POST `/v1/tasks/:taskId/compact`, 409), so clients word
 * it in their own language; `error.message` stays the service's English explanation.
 * `compaction_unavailable` covers Pi refusing for any other reason.
 */
export const CompactRefusalSchema = Type.Union([
  Type.Literal('active_run'),
  Type.Literal('already_compacting'),
  Type.Literal('nothing_to_compact'),
  Type.Literal('compaction_unavailable'),
]);
export type CompactRefusal = Static<typeof CompactRefusalSchema>;

/** Machine-readable error codes; `owner` on 501 names the responsible todo. */
export const ErrorCodeSchema = Type.Union([
  Type.Literal('bad_request'),
  Type.Literal('unauthorized'),
  Type.Literal('forbidden'),
  Type.Literal('not_found'),
  Type.Literal('conflict'),
  /** A 409 from the compact route that says which refusal it is. */
  CompactRefusalSchema,
  Type.Literal('gone'),
  Type.Literal('payload_too_large'),
  Type.Literal('auth_required'),
  /** 403: an MCP server's launch is not approved as it stands (mcp-approvals.ts). */
  Type.Literal('approval_required'),
  /** 409: an MCP launch approval named a fingerprint that no longer matches. */
  Type.Literal('approval_changed'),
  Type.Literal('desktop_unavailable'),
  Type.Literal('draining'),
  /** 502: a model provider the service called on the user's behalf failed. */
  Type.Literal('upstream_failed'),
  /** 404: no user app has the id. */
  Type.Literal('app_not_found'),
  /** 422: an app build was refused or failed; no version was published. */
  Type.Literal('app_build_failed'),
  /** 503: the app's backend could not start, crashed or is restarting after a crash. */
  Type.Literal('app_backend_unavailable'),
  /** 403: the user denied the capability, or the app's manifest does not list it. */
  Type.Literal('app_capability_denied'),
  /**
   * 409 before any handler ran: the request's `x-relay-epoch` names another service epoch than
   * the running one. The response also carries `x-relay-epoch-current` (see relay.ts).
   */
  Type.Literal('epoch_mismatch'),
  Type.Literal('not_implemented'),
  Type.Literal('internal'),
]);
export type ErrorCode = Static<typeof ErrorCodeSchema>;

/** Owner tags for future-route 501 placeholders; never a fake success. */
export const FutureOwnerSchema = Type.Union([
  Type.Literal('T2'),
  Type.Literal('T3'),
  Type.Literal('T4'),
  Type.Literal('T5'),
  Type.Literal('T6'),
]);
export type FutureOwner = Static<typeof FutureOwnerSchema>;

/** Envelope of every HTTP error response. */
export const ErrorEnvelopeSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: ErrorCodeSchema,
        message: Type.String(),
        owner: Type.Optional(FutureOwnerSchema),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ErrorEnvelope = Static<typeof ErrorEnvelopeSchema>;

/** Where the service listens; written to endpoint.json after the port binds. */
export const EndpointSchema = Type.Object(
  {
    host: Type.String({ maxLength: 256 }),
    port: Type.Integer({ minimum: 1, maximum: 65535 }),
    url: Type.String({ maxLength: 2048 }),
  },
  { additionalProperties: false },
);
export type Endpoint = Static<typeof EndpointSchema>;

/** Service identity served by /v1/status and echoed on every response. */
export const ServiceInfoSchema = Type.Object(
  {
    serviceId: Identifier,
    service: Type.String({ maxLength: 64 }),
    protocolVersion: Type.String({ maxLength: 16 }),
    /** Monotonic boot counter persisted in service.json; restarts are detectable. */
    epoch: Type.Integer({ minimum: 0 }),
    startedAt: Type.String(),
    endpoint: EndpointSchema,
  },
  { additionalProperties: false },
);
export type ServiceInfo = Static<typeof ServiceInfoSchema>;

/** Extended status with liveness and load; still authenticated like every route. */
export const StatusResponseSchema = Type.Object(
  {
    service: ServiceInfoSchema,
    draining: Type.Boolean(),
    activeRuns: Type.Integer({ minimum: 0 }),
    pendingConfirms: Type.Integer({ minimum: 0 }),
    pendingCapabilities: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type StatusResponse = Static<typeof StatusResponseSchema>;

/** Restricted local credential file granting loopback clients the bearer token. */
export const ServiceTokenFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    serviceId: Identifier,
    token: Type.String({ minLength: 32, maxLength: 256 }),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);
export type ServiceTokenFile = Static<typeof ServiceTokenFileSchema>;
