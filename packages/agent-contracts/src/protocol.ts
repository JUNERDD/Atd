import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/** Machine-readable error codes; `owner` on 501 names the responsible todo. */
export const ErrorCodeSchema = Type.Union([
  Type.Literal('bad_request'),
  Type.Literal('unauthorized'),
  Type.Literal('forbidden'),
  Type.Literal('not_found'),
  Type.Literal('conflict'),
  Type.Literal('gone'),
  Type.Literal('payload_too_large'),
  Type.Literal('auth_required'),
  Type.Literal('desktop_unavailable'),
  Type.Literal('draining'),
  /** 502: a model provider the service called on the user's behalf failed. */
  Type.Literal('upstream_failed'),
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
