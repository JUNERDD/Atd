import { Type, type Static } from 'typebox';
import {
  AppAccentColorSchema,
  AppGrantsSchema,
  AppIdSchema,
  AppManifestSchema,
  AppNameSchema,
  AppRuntimeWindowSchema,
  APP_DESCRIPTION_MAX_LENGTH,
  CapabilitySchema,
  DataStoreIdSchema,
  Identifier,
  WidgetDeclSchema,
  type AppCapabilityConsent,
  type AppDetail,
  type AppManifest,
  type AppRuntimeWindow,
  type AppSummary,
} from '@atd/agent-contracts';

/**
 * The service's own app files (`app.json`, `index.json`). They are persisted data the service
 * alone writes; the route bodies in `apps.ts` are projections of them.
 */

/**
 * `<appId>/app.json`. `purposes` and `accentColor` keep the current manifest's values. `widgets`
 * are the declarations the backend of `widgetsVersion` reported in its `ready` message; a newer
 * current version shows none until its backend first starts.
 */
export const AppRecordSchema = Type.Object(
  {
    id: AppIdSchema,
    name: AppNameSchema,
    description: Type.String({ maxLength: APP_DESCRIPTION_MAX_LENGTH }),
    accentColor: Type.Optional(AppAccentColorSchema),
    sourceTaskId: Identifier,
    currentVersion: Type.Integer({ minimum: 1 }),
    dataStoreId: DataStoreIdSchema,
    window: AppRuntimeWindowSchema,
    capabilities: Type.Array(CapabilitySchema, { maxItems: 5, uniqueItems: true }),
    purposes: AppManifestSchema.properties.purposes,
    grants: AppGrantsSchema,
    widgets: Type.Array(WidgetDeclSchema, { maxItems: 16 }),
    widgetsVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    createdAt: Type.String(),
    updatedAt: Type.String(),
  },
  { additionalProperties: false },
);
export type AppRecord = Static<typeof AppRecordSchema>;

/** `apps/index.json`: the store revision and a summary line per app, for humans and recovery. */
export const AppIndexSchema = Type.Object(
  {
    version: Type.Literal(1),
    revision: Type.Integer({ minimum: 0 }),
    apps: Type.Array(
      Type.Object(
        {
          id: AppIdSchema,
          name: AppNameSchema,
          currentVersion: Type.Integer({ minimum: 1 }),
          updatedAt: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type AppIndex = Static<typeof AppIndexSchema>;

/** Minimum window size when the manifest names none. */
const DEFAULT_MIN = 200;

/** The runtime window of a manifest: its size, minimums filled and never above the size. */
export function runtimeWindow(manifest: AppManifest): AppRuntimeWindow {
  const { width, height } = manifest.window;
  return {
    width,
    height,
    minWidth: Math.min(manifest.window.minWidth ?? DEFAULT_MIN, width),
    minHeight: Math.min(manifest.window.minHeight ?? DEFAULT_MIN, height),
  };
}

export function toSummary(record: AppRecord, consents: AppCapabilityConsent[]): AppSummary {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    ...(record.accentColor ? { accentColor: record.accentColor } : {}),
    currentVersion: record.currentVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    consents,
  };
}

export function toDetail(record: AppRecord, consents: AppCapabilityConsent[]): AppDetail {
  return {
    ...toSummary(record, consents),
    sourceTaskId: record.sourceTaskId,
    window: record.window,
    capabilities: record.capabilities,
    grants: record.grants,
    widgets: record.widgetsVersion === record.currentVersion ? record.widgets : [],
  };
}
