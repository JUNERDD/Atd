import { Type, type Static } from 'typebox';
import { AppAccentColorSchema, AppIdSchema } from './app-identity.js';
import { APP_ICON_MAX_BYTES } from './apps.js';
import {
  WidgetDeclSchema,
  WidgetFamilySchema,
  WidgetIdSchema,
  WidgetTimelineSchema,
  type WidgetFamily,
} from './widgets.js';

/**
 * How widget renders reach the WidgetKit extension: the shell reports the widget instances the
 * system shows, the service renders those through the app backends, and the shell pulls the
 * catalog and the snapshots and writes them where the sandboxed extension can read them. The same
 * pull carries the list the "My Apps" launcher widget shows, which needs no renders.
 */

/** ISO 8601 date-time with an offset, as `Date.prototype.toISOString` writes it. */
const DateTime = Type.String({ format: 'date-time', maxLength: 64 });

/**
 * One widget the system currently shows (`WidgetCenter.getCurrentConfigurations`): its WidgetKit
 * `kind` and family, and the app widget it shows when the reporter knows it. The shell does not:
 * the configurable widget's choice can only be read with its intent type, which lives in the
 * extension alone, so it sends neither id and the service renders every declared widget of that
 * family.
 */
export const WidgetInstanceSchema = Type.Object(
  {
    kind: Type.String({ minLength: 1, maxLength: 128 }),
    family: WidgetFamilySchema,
    appId: Type.Optional(AppIdSchema),
    widgetId: Type.Optional(WidgetIdSchema),
  },
  { additionalProperties: false },
);
export type WidgetInstance = Static<typeof WidgetInstanceSchema>;

/** `POST /v1/widgets/instances` (shell): every live instance; the service renders only these. */
export const WidgetInstancesRequestSchema = Type.Object(
  { instances: Type.Array(WidgetInstanceSchema, { maxItems: 128 }) },
  { additionalProperties: false },
);
export type WidgetInstancesRequest = Static<typeof WidgetInstancesRequestSchema>;

/** One app in the widget catalog: the picker of the configurable widget lists its widgets. */
export const WidgetCatalogAppSchema = Type.Object(
  {
    appId: AppIdSchema,
    name: Type.String({ minLength: 1, maxLength: 64 }),
    /** The app's manifest `accentColor`, which its widgets' `accent` token takes. */
    accentColor: Type.Optional(AppAccentColorSchema),
    widgets: Type.Array(WidgetDeclSchema, { maxItems: 16 }),
  },
  { additionalProperties: false },
);
export type WidgetCatalogApp = Static<typeof WidgetCatalogAppSchema>;

/** Most apps the "My Apps" launcher lists: its large size shows a grid of four by four. */
export const WIDGET_LAUNCHER_MAX_APPS = 16;

/**
 * Largest `icon.svg` the shell copies for the launcher: the bound publishing already keeps icons
 * within (`APP_ICON_MAX_BYTES`); a larger file is left out and the launcher draws the app's
 * fallback tile instead.
 */
export const WIDGET_LAUNCHER_ICON_MAX_BYTES = APP_ICON_MAX_BYTES;

/**
 * One app of the "My Apps" launcher. `iconRevision` is the app's build revision (`AppSummary`
 * `revision`), which changes with every publish, an in-place build of the current version
 * included: the shell copies the current build's `icon.svg` next to the other widget files only
 * when it differs from the revision it copied last. The icon is SVG an agent wrote, so the shell
 * copies its bytes without parsing them; only the sandboxed extension draws it.
 */
export const WidgetLauncherAppSchema = Type.Object(
  {
    appId: AppIdSchema,
    name: Type.String({ minLength: 1, maxLength: 64 }),
    /** The app's manifest `accentColor`, which fills its tile when the icon cannot be drawn. */
    accentColor: Type.Optional(AppAccentColorSchema),
    iconRevision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type WidgetLauncherApp = Static<typeof WidgetLauncherAppSchema>;

/** The latest render of one (app, widget, family) and when it was made. */
export const WidgetSnapshotSchema = Type.Object(
  { generatedAt: DateTime, timeline: WidgetTimelineSchema },
  { additionalProperties: false },
);
export type WidgetSnapshot = Static<typeof WidgetSnapshotSchema>;

/** Key of `WidgetSync.snapshots`: `<appId>/<widgetId>/<family>`. */
export const WIDGET_SNAPSHOT_KEY_PATTERN =
  '^app-[a-z0-9]{10}/[a-z][a-z0-9-]{0,31}/(systemSmall|systemMedium|systemLarge)$';

export function widgetSnapshotKey(appId: string, widgetId: string, family: WidgetFamily): string {
  return `${appId}/${widgetId}/${family}`;
}

/**
 * `GET /v1/widgets/snapshots` (shell): the whole catalog and every snapshot, which the shell writes
 * atomically to the extension-readable directory after an `invalidate` with scope `widgets`. The
 * catalog lists the most recently updated app first; the extension keeps that order for its
 * picker, its default choice and the gallery preview, which shows the newest widget of each family.
 * `launcher` lists every app in the same order, whether or not it declares a widget, as many as the
 * launcher shows; the service sends the invalidate whenever that list changes too (an app created,
 * published anew, renamed, reverted, deleted or moved up by an update).
 */
export const WidgetSyncSchema = Type.Object(
  {
    catalog: Type.Array(WidgetCatalogAppSchema, { maxItems: 256 }),
    snapshots: Type.Record(
      Type.String({ pattern: WIDGET_SNAPSHOT_KEY_PATTERN }),
      WidgetSnapshotSchema,
      { additionalProperties: false },
    ),
    launcher: Type.Array(WidgetLauncherAppSchema, { maxItems: WIDGET_LAUNCHER_MAX_APPS }),
  },
  { additionalProperties: false },
);
export type WidgetSync = Static<typeof WidgetSyncSchema>;
