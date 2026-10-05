import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
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
  parse,
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

const recordFields = {
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
  createdAt: Type.String(),
  updatedAt: Type.String(),
};

/** A build revision, or null before the app's backend first reported its widgets. */
const RevisionOrNull = Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]);

/**
 * `<appId>/app.json`. `purposes` and `accentColor` keep the current manifest's values.
 * `revision` is the build revision of the current version's files (`versions/.rev-<revision>`
 * when it was published with revisions). `widgets` are the declarations the backend of build
 * `widgetsRevision` last reported in its `ready` message. They stay recorded through a newer
 * build, in place or not, so the widget catalog keeps the app until that build's backend reports
 * its own; the app's detail shows them only once they belong to the current build. A build
 * without a backend clears them, since nothing would ever report for it.
 */
export const AppRecordSchema = Type.Object(
  {
    ...recordFields,
    revision: Type.Integer({ minimum: 1 }),
    widgetsRevision: RevisionOrNull,
  },
  { additionalProperties: false },
);
export type AppRecord = Static<typeof AppRecordSchema>;

/** `app.json` as it was written before build revisions, with widgets keyed on a version. */
const PreRevisionRecordSchema = Type.Object(
  { ...recordFields, widgetsVersion: RevisionOrNull },
  { additionalProperties: false },
);

/**
 * Reads an `app.json`. One written before build revisions is upgraded: each build then published
 * a version of its own, so the current version number is its revision, which is also the value
 * the launcher's icon copies and the icon caches were keyed on.
 */
export function readRecord(value: unknown): AppRecord {
  if (!Value.Check(PreRevisionRecordSchema, value)) return parse(AppRecordSchema, value);
  const { widgetsVersion, ...rest } = value;
  return { ...rest, revision: rest.currentVersion, widgetsRevision: widgetsVersion };
}

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
    revision: record.revision,
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
    widgets: record.widgetsRevision === record.revision ? record.widgets : [],
  };
}
