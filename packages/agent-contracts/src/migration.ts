import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/**
 * T2 migration contracts (additive to service-contracts v1). The manifest is
 * the versioned record of a desktop -> service data move; every domain import
 * is idempotent and the source data is never deleted by the service.
 */
export const MIGRATION_MANIFEST_VERSION = 1;

/** Migratable desktop domains, in import order. */
export const MigrationDomainSchema = Type.Union([
  Type.Literal('tasks'),
  Type.Literal('commands'),
  Type.Literal('policy'),
  Type.Literal('resources'),
  Type.Literal('sessions'),
  Type.Literal('providers'),
  Type.Literal('memory'),
]);
export type MigrationDomain = Static<typeof MigrationDomainSchema>;

export const MigrationDomainStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('imported'),
  Type.Literal('verified'),
  Type.Literal('failed'),
  Type.Literal('skipped'),
]);
export type MigrationDomainStatus = Static<typeof MigrationDomainStatusSchema>;

export const MigrationDomainRecordSchema = Type.Object(
  {
    status: MigrationDomainStatusSchema,
    /** Items imported in the last attempt (0 when the domain was empty). */
    count: Type.Integer({ minimum: 0 }),
    /** sha256 over the canonical source bytes the last attempt verified. */
    checksum: Type.String({ maxLength: 128 }),
    error: Type.String({ maxLength: 2000 }),
    attemptedAt: Type.String({ maxLength: 64 }),
  },
  { additionalProperties: false },
);
export type MigrationDomainRecord = Static<typeof MigrationDomainRecordSchema>;

/** Per-connection credential/model verdicts; never carries secret values. */
export const MigrationCredentialRecordSchema = Type.Object(
  {
    connectionId: Identifier,
    provider: Type.String({ maxLength: 256 }),
    uploaded: Type.Boolean(),
    readable: Type.Boolean(),
    /** Model-connection check outcome, or `unchecked` when creds are absent. */
    modelCheck: Type.Union([
      Type.Literal('unchecked'),
      Type.Literal('passed'),
      Type.Literal('failed'),
    ]),
    detail: Type.String({ maxLength: 2000 }),
  },
  { additionalProperties: false },
);
export type MigrationCredentialRecord = Static<typeof MigrationCredentialRecordSchema>;

export const MigrationManifestSchema = Type.Object(
  {
    version: Type.Literal(1),
    serviceId: Identifier,
    /** Desktop userData the bytes were copied from (an isolated copy path). */
    sourceRoot: Type.String({ maxLength: 2048 }),
    sourceVersion: Type.String({ maxLength: 64 }),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    /** Set once every required domain verified; new tasks then belong to the service. */
    completedAt: Type.Union([Type.String(), Type.Null()]),
    /** Desktop confirmed old executions paused before the copy started. */
    pausedAt: Type.Union([Type.String(), Type.Null()]),
    /** Desktop confirmed memory flushed/closed before the memory copy. */
    flushedAt: Type.Union([Type.String(), Type.Null()]),
    domains: Type.Record(Type.String(), MigrationDomainRecordSchema),
    credentials: Type.Array(MigrationCredentialRecordSchema),
    notes: Type.Array(Type.String({ maxLength: 2000 }), { maxItems: 50 }),
  },
  { additionalProperties: false },
);
export type MigrationManifest = Static<typeof MigrationManifestSchema>;

/** Credential payload the desktop uploads after a one-time safeStorage decrypt. */
export const MigrationCredentialSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal('api_key'),
      key: Type.Optional(Type.String({ maxLength: 8192 })),
      env: Type.Optional(Type.Record(Type.String(), Type.String({ maxLength: 2048 }))),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('oauth'),
      access: Type.String({ maxLength: 8192 }),
      refresh: Type.String({ maxLength: 8192 }),
      expires: Type.Number(),
    },
    { additionalProperties: false },
  ),
]);
export type MigrationCredential = Static<typeof MigrationCredentialSchema>;

export const CredentialUploadRequestSchema = Type.Object(
  {
    connectionId: Identifier,
    providerId: Type.String({ minLength: 1, maxLength: 256 }),
    configurationId: Type.String({ minLength: 1, maxLength: 256 }),
    credential: MigrationCredentialSchema,
  },
  { additionalProperties: false },
);
export type CredentialUploadRequest = Static<typeof CredentialUploadRequestSchema>;

export const CredentialUploadResponseSchema = Type.Object(
  {
    connectionId: Identifier,
    readable: Type.Boolean(),
    modelCheck: Type.Union([
      Type.Literal('unchecked'),
      Type.Literal('passed'),
      Type.Literal('failed'),
    ]),
  },
  { additionalProperties: false },
);
export type CredentialUploadResponse = Static<typeof CredentialUploadResponseSchema>;

export const MigrationStatusResponseSchema = Type.Object(
  {
    manifest: Type.Union([MigrationManifestSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type MigrationStatusResponse = Static<typeof MigrationStatusResponseSchema>;

/** Metadata the service persists per provider connection; never a secret. */
export const ServiceConnectionSchema = Type.Object(
  {
    connectionId: Identifier,
    provider: Type.String({ minLength: 1, maxLength: 256 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    baseUrl: Type.String({ maxLength: 2048 }),
    authType: Type.Union([
      Type.Literal('api_key'),
      Type.Literal('oauth'),
      Type.Literal('none'),
      Type.Literal('ambient'),
    ]),
    defaultModel: Type.String({ maxLength: 256 }),
    revision: Type.Integer({ minimum: 1 }),
    connected: Type.Boolean(),
    hasCredential: Type.Boolean(),
    configurationId: Type.String({ minLength: 1, maxLength: 256 }),
    verifiedModel: Type.String({ maxLength: 256 }),
    migratedAt: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ServiceConnection = Static<typeof ServiceConnectionSchema>;

export const ServiceConnectionsFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    defaultConnectionId: Type.Union([Identifier, Type.Null()]),
    connections: Type.Array(ServiceConnectionSchema, { maxItems: 100 }),
  },
  { additionalProperties: false },
);
export type ServiceConnectionsFile = Static<typeof ServiceConnectionsFileSchema>;

/** Commands the service owns after migration; mirrors the desktop definition. */
export const ServiceCommandSchema = Type.Object(
  {
    id: Identifier,
    revision: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ maxLength: 500 }),
    instructions: Type.String({ minLength: 1, maxLength: 20000 }),
    enabled: Type.Boolean(),
    tools: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 20 }),
    memory: Type.Union([Type.Literal('inherit'), Type.Literal('off')]),
    migratedAt: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: true },
);
export type ServiceCommand = Static<typeof ServiceCommandSchema>;

export const ServiceCommandsFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    commands: Type.Array(ServiceCommandSchema, { maxItems: 500 }),
  },
  { additionalProperties: false },
);
export type ServiceCommandsFile = Static<typeof ServiceCommandsFileSchema>;
