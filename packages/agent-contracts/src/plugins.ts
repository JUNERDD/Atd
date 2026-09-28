import {
  NormalizedPluginSchema,
  PluginDiagnosticSchema,
  PluginSourceSpecSchema,
  ResolvedSourceSchema,
  UserConfigOptionSchema,
  PluginFormatSchema,
  PluginManifestSchema,
} from '@ai/plugin-kit/model';
import { Type, type Static } from 'typebox';

/**
 * Plugin management DTOs for `/v1/plugins`. The service owns the plugin model (plugin-kit resolves
 * host and installed plugins); clients only render it. Plugin ids are `builtin:core`, `user`
 * (Personal, which also holds the one memory item: its switch is the memory pause),
 * `shared:agents-skills`, or an installed plugin's manifest name, and are URL-encoded in paths.
 *
 * Routes:
 * - `GET    /v1/plugins`                                     → PluginListResponse
 * - `GET    /v1/plugins/:id`                                 → PluginDetail
 * - `POST   /v1/plugins/:id/enabled`                         PluginEnabledRequest → PluginDetail
 * - `POST   /v1/plugins/:id/items/:kind/:name/enabled`       PluginEnabledRequest → PluginDetail
 * - `POST   /v1/plugins/:id/servers/:name/approval`          PluginApprovalRequest → PluginDetail
 * - `PUT    /v1/plugins/:id/config`                          PluginConfigRequest → PluginDetail
 * - `POST   /v1/plugins/:id/items/:kind/:name/duplicate`     → PluginDuplicateResponse
 * - `POST   /v1/plugins/preview`                             PluginPreviewRequest → PluginInstallPreview
 * - `POST   /v1/plugins/:id/update/preview`                  → PluginInstallPreview
 * - `POST   /v1/plugins/install`                             PluginInstallRequest → PluginDetail
 * - `DELETE /v1/plugins/:id`                                 → { removed: true }
 *
 * Every mutation emits the service `extensions` change event.
 */

export const PluginIdSchema = Type.String({ minLength: 1, maxLength: 128 });

export const PluginItemKindSchema = Type.Union([
  Type.Literal('skill'),
  Type.Literal('agent'),
  Type.Literal('command'),
  Type.Literal('mcp'),
  Type.Literal('memory'),
]);
export type PluginItemKind = Static<typeof PluginItemKindSchema>;

const Counts = Type.Object(
  {
    skill: Type.Integer({ minimum: 0 }),
    agent: Type.Integer({ minimum: 0 }),
    command: Type.Integer({ minimum: 0 }),
    mcp: Type.Integer({ minimum: 0 }),
    memory: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const PluginSummarySchema = Type.Object(
  {
    id: PluginIdSchema,
    origin: Type.Union([Type.Literal('host'), Type.Literal('installed')]),
    name: Type.String({ maxLength: 256 }),
    displayName: Type.Optional(Type.String({ maxLength: 256 })),
    description: Type.String({ maxLength: 4000 }),
    version: Type.Optional(Type.String({ maxLength: 256 })),
    format: Type.Optional(PluginFormatSchema),
    source: Type.Optional(PluginSourceSpecSchema),
    revision: Type.Optional(Type.String({ maxLength: 64 })),
    license: Type.Optional(Type.String({ maxLength: 256 })),
    installedAt: Type.Optional(Type.String()),
    enabled: Type.Boolean(),
    toggleable: Type.Boolean(),
    removable: Type.Boolean(),
    updatable: Type.Boolean(),
    needsConfig: Type.Boolean(),
    counts: Counts,
    diagnostics: Type.Array(PluginDiagnosticSchema),
  },
  { additionalProperties: false },
);
export type PluginSummary = Static<typeof PluginSummarySchema>;

export const PluginListResponseSchema = Type.Object(
  { plugins: Type.Array(PluginSummarySchema) },
  { additionalProperties: false },
);
export type PluginListResponse = Static<typeof PluginListResponseSchema>;

/** One item of a plugin as the settings UI lists it. */
export const PluginItemSchema = Type.Object(
  {
    pluginId: PluginIdSchema,
    kind: PluginItemKindSchema,
    /** Name inside the plugin. */
    localName: Type.String({ maxLength: 256 }),
    /** Qualified name the rest of the API uses (`<plugin>:<item>` for installed plugins). */
    name: Type.String({ maxLength: 256 }),
    /**
     * Display name when it differs from `name`: Personal commands are addressed by command id, so
     * their `name` is the id and `title` is the command's name.
     */
    title: Type.Optional(Type.String({ maxLength: 256 })),
    description: Type.String({ maxLength: 4000 }),
    itemEnabled: Type.Boolean(),
    enabled: Type.Boolean(),
    blockedBy: Type.Optional(
      Type.Union([
        Type.Literal('plugin'),
        Type.Literal('item'),
        Type.Literal('approval'),
        Type.Literal('config'),
        Type.Literal('collision'),
      ]),
    ),
    /** Items of installed and shared plugins cannot be edited, only toggled or duplicated. */
    readOnly: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type PluginItem = Static<typeof PluginItemSchema>;

/** A configured value; sensitive values are never returned, only whether they are set. */
export const PluginConfigValueSchema = Type.Object(
  {
    set: Type.Boolean(),
    value: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
  },
  { additionalProperties: false },
);

export const PluginDetailSchema = Type.Object(
  {
    plugin: PluginSummarySchema,
    manifest: Type.Optional(PluginManifestSchema),
    resolved: Type.Optional(ResolvedSourceSchema),
    items: Type.Array(PluginItemSchema),
    userConfig: Type.Array(UserConfigOptionSchema),
    config: Type.Record(Type.String(), PluginConfigValueSchema),
  },
  { additionalProperties: false },
);
export type PluginDetail = Static<typeof PluginDetailSchema>;

export const PluginEnabledRequestSchema = Type.Object(
  { enabled: Type.Boolean() },
  { additionalProperties: false },
);
export type PluginEnabledRequest = Static<typeof PluginEnabledRequestSchema>;

export const PluginApprovalRequestSchema = Type.Object(
  { approved: Type.Boolean() },
  { additionalProperties: false },
);
export type PluginApprovalRequest = Static<typeof PluginApprovalRequestSchema>;

/** `null` clears a value. */
export const PluginConfigRequestSchema = Type.Object(
  {
    values: Type.Record(
      Type.String(),
      Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);
export type PluginConfigRequest = Static<typeof PluginConfigRequestSchema>;

export const PluginDuplicateResponseSchema = Type.Object(
  { kind: PluginItemKindSchema, name: Type.String({ maxLength: 256 }) },
  { additionalProperties: false },
);
export type PluginDuplicateResponse = Static<typeof PluginDuplicateResponseSchema>;

export const PluginPreviewRequestSchema = Type.Object(
  { source: PluginSourceSpecSchema },
  { additionalProperties: false },
);
export type PluginPreviewRequest = Static<typeof PluginPreviewRequestSchema>;

export const PluginInstallRequestSchema = Type.Object(
  { previewId: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false },
);
export type PluginInstallRequest = Static<typeof PluginInstallRequestSchema>;

/** A fetched bundle awaiting confirmation; mirrors plugin-kit `InstallPreview`. */
export const PluginInstallPreviewSchema = Type.Object(
  {
    previewId: Type.String(),
    expiresAt: Type.String(),
    source: PluginSourceSpecSchema,
    resolved: ResolvedSourceSchema,
    revision: Type.String(),
    plugin: NormalizedPluginSchema,
    existing: Type.Optional(
      Type.Object(
        { revision: Type.String(), source: PluginSourceSpecSchema },
        { additionalProperties: false },
      ),
    ),
    review: Type.Object(
      {
        stdio: Type.Array(
          Type.Object(
            { name: Type.String(), command: Type.String(), args: Type.Array(Type.String()) },
            { additionalProperties: false },
          ),
        ),
        urls: Type.Array(
          Type.Object({ name: Type.String(), url: Type.String() }, { additionalProperties: false }),
        ),
        scripts: Type.Array(Type.String()),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type PluginInstallPreview = Static<typeof PluginInstallPreviewSchema>;
