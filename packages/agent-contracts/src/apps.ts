import { Type, type Static } from 'typebox';
import {
  APP_DESCRIPTION_MAX_LENGTH,
  AppAccentColorSchema,
  AppErrorSchema,
  AppGrantsSchema,
  AppIdSchema,
  AppNameSchema,
  CapabilitySchema,
  DataStoreIdSchema,
  GrantStateSchema,
} from './app-identity.js';
import { AppPurposeSchema, AppRuntimeWindowSchema } from './app-manifest.js';
import { Identifier } from './identifiers.js';
import { WidgetDeclSchema } from './widgets.js';

/**
 * User apps the service owns (`<dataDir>/apps/<appId>/`): the app records and versions the
 * renderer lists, the runtime the shell loads, and the bodies of the `/v1/apps` routes. The
 * manifest the agent writes lives in `app-manifest.ts`, the backend IPC in `apps-ipc.ts`, widgets
 * in `widgets.ts`.
 *
 * A version is what one agent run published: the run's first successful `app.build` publishes
 * the next version, and its later builds replace that version's files in place, keeping its
 * number. A build in another run, a build outside any run and a revert each publish a new
 * version. Every publish, in place or not, takes the app's next build revision; whatever keys
 * on an app's files (an open window, the backend, widget renders, icon caches) keys on the
 * revision, since the version number alone does not change on an in-place build.
 */

export const APP_SUMMARY_MAX_LENGTH = 500;
/** Largest `icon.svg` a version keeps; a build leaves a larger one out with a warning. */
export const APP_ICON_MAX_BYTES = 256 * 1024;
/** Versions kept per app; older ones are pruned when a build or revert publishes a new one. */
export const APP_MAX_VERSIONS = 20;

/** The non-blocking type check a build ran; errors are in the app's `typecheck` diagnostics. */
export const AppTypecheckSchema = Type.Object(
  { ok: Type.Boolean(), errorCount: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);
export type AppTypecheck = Static<typeof AppTypecheckSchema>;

/** An app's build revision; see the module comment. */
const RevisionSchema = Type.Integer({ minimum: 1 });

/**
 * One published version (`versions/<n>/version.json`). `runId` names the run whose `app.build`
 * published it; a revert has none. `createdAt` is when the version was first published;
 * `revision`, `updatedAt`, `summary` and `typecheck` describe the build that last wrote it, the
 * run's latest.
 */
export const AppVersionSchema = Type.Object(
  {
    n: Type.Integer({ minimum: 1 }),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    revision: RevisionSchema,
    runId: Type.Optional(Identifier),
    summary: Type.String({ maxLength: APP_SUMMARY_MAX_LENGTH }),
    typecheck: AppTypecheckSchema,
  },
  { additionalProperties: false },
);
export type AppVersion = Static<typeof AppVersionSchema>;

/**
 * A capability request waiting for the user's consent (`kind` leaves room for other app-level
 * prompts). It belongs to the app, not to a task: an app window calls its backend without any
 * task, so it does not ride the task-scoped confirm channel. The service lists it on the app
 * record and sends an `invalidate` with scope `apps` when it appears or goes; the user answers by
 * `PATCH /v1/apps/:appId/grants` with `granted` or `denied` for that capability, which settles
 * every request waiting on it. Requests the backend cancels or that time out simply disappear.
 */
export const AppCapabilityConsentSchema = Type.Object(
  {
    id: Identifier,
    kind: Type.Literal('app.capability'),
    appId: AppIdSchema,
    appName: AppNameSchema,
    capability: CapabilitySchema,
    /** The manifest's `purposes` entry for the capability. */
    purpose: Type.Optional(AppPurposeSchema),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);
export type AppCapabilityConsent = Static<typeof AppCapabilityConsentSchema>;

const appSummaryFields = {
  id: AppIdSchema,
  name: AppNameSchema,
  description: Type.String({ maxLength: APP_DESCRIPTION_MAX_LENGTH }),
  /** The current version's manifest `accentColor`; absent when it names none. */
  accentColor: Type.Optional(AppAccentColorSchema),
  currentVersion: Type.Integer({ minimum: 1 }),
  /** The build revision of the current version's files; it changes with every publish. */
  revision: RevisionSchema,
  createdAt: Type.String(),
  updatedAt: Type.String(),
  /** Pending consents, at most one per capability, oldest first. */
  consents: Type.Array(AppCapabilityConsentSchema, { maxItems: 5 }),
};

/** One app in `GET /v1/apps`. Its icon is `GET /v1/apps/:appId/icon` (the current version's). */
export const AppSummarySchema = Type.Object(appSummaryFields, { additionalProperties: false });
export type AppSummary = Static<typeof AppSummarySchema>;

/**
 * `GET /v1/apps/:appId`: the summary plus what settings and the transcript card show.
 * `sourceTaskId` is the task that created the app; it may have been deleted since (`edit` then
 * starts a new task). `widgets` are the declarations of the current build (`revision`), empty
 * until its backend first reported them.
 */
export const AppDetailSchema = Type.Object(
  {
    ...appSummaryFields,
    sourceTaskId: Identifier,
    window: AppRuntimeWindowSchema,
    capabilities: Type.Array(CapabilitySchema, { maxItems: 5, uniqueItems: true }),
    grants: AppGrantsSchema,
    widgets: Type.Array(WidgetDeclSchema, { maxItems: 16 }),
  },
  { additionalProperties: false },
);
export type AppDetail = Static<typeof AppDetailSchema>;

/** `GET /v1/apps`, most recently updated first; `revision` grows with every change. */
export const AppListResponseSchema = Type.Object(
  { revision: Type.Integer({ minimum: 0 }), apps: Type.Array(AppSummarySchema) },
  { additionalProperties: false },
);
export type AppListResponse = Static<typeof AppListResponseSchema>;

/** `PATCH /v1/apps/:appId` → `AppDetail`. */
export const PatchAppRequestSchema = Type.Object(
  { name: Type.Optional(AppNameSchema) },
  { additionalProperties: false },
);
export type PatchAppRequest = Static<typeof PatchAppRequestSchema>;

/** `GET /v1/apps/:appId/versions`, newest first. */
export const AppVersionsResponseSchema = Type.Object(
  { versions: Type.Array(AppVersionSchema, { maxItems: APP_MAX_VERSIONS }) },
  { additionalProperties: false },
);
export type AppVersionsResponse = Static<typeof AppVersionsResponseSchema>;

/**
 * `POST /v1/apps/:appId/revert` → `AppDetail`: publishes a copy of `version` as a new version;
 * history is never rewritten and the app's data is not rolled back.
 */
export const RevertAppRequestSchema = Type.Object(
  { version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export type RevertAppRequest = Static<typeof RevertAppRequestSchema>;

/** `POST /v1/apps/:appId/edit`: the task to continue in (the source task, or a new one). */
export const EditAppResponseSchema = Type.Object(
  { taskId: Identifier },
  { additionalProperties: false },
);
export type EditAppResponse = Static<typeof EditAppResponseSchema>;

const GrantPatch = Type.Optional(Type.Union([GrantStateSchema, Type.Null()]));

/**
 * `PATCH /v1/apps/:appId/grants` → `AppDetail`: listed capabilities take the new state; `null`
 * forgets the answer, so the next use asks again. Also answers pending consents.
 */
export const PatchAppGrantsRequestSchema = Type.Object(
  {
    grants: Type.Object(
      { ai: GrantPatch, agent: GrantPatch, memory: GrantPatch, mcp: GrantPatch, web: GrantPatch },
      { additionalProperties: false, minProperties: 1 },
    ),
  },
  { additionalProperties: false },
);
export type PatchAppGrantsRequest = Static<typeof PatchAppGrantsRequestSchema>;

/**
 * `GET /v1/apps/:appId/runtime` (shell): what the app window loads. `webRoot` is the absolute,
 * link-free path of the `web/` directory of the current build (`revision`); every build has a
 * directory of its own that stays unchanged, so an in-place build of the same `version` moves
 * `webRoot`, and a window reloads when it changed.
 */
export const AppRuntimeSchema = Type.Object(
  {
    appId: AppIdSchema,
    name: AppNameSchema,
    version: Type.Integer({ minimum: 1 }),
    revision: RevisionSchema,
    webRoot: Type.String({ minLength: 1, maxLength: 4096 }),
    dataStoreId: DataStoreIdSchema,
    window: AppRuntimeWindowSchema,
  },
  { additionalProperties: false },
);
export type AppRuntime = Static<typeof AppRuntimeSchema>;

/** `accept` value that asks `POST /v1/apps/:appId/api/:name` for an NDJSON stream. */
export const APP_STREAM_CONTENT_TYPE = 'application/x-ndjson';

/**
 * One line of a streamed app API call: any number of `chunk`s, then exactly one `result` or
 * `error`, after which the stream ends.
 */
export const AppStreamLineSchema = Type.Union([
  Type.Object(
    { type: Type.Literal('chunk'), data: Type.Unknown() },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal('result'), value: Type.Unknown() },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal('error'), error: AppErrorSchema },
    { additionalProperties: false },
  ),
]);
export type AppStreamLine = Static<typeof AppStreamLineSchema>;

/** A backend event channel name (`ctx.events.publish(channel, data)`). */
export const AppEventChannelSchema = Type.String({ pattern: '^[A-Za-z0-9_.:-]{1,64}$' });

/**
 * The `data:` JSON of one `GET /v1/apps/:appId/events` server-sent event, sent without an
 * `event:` field (type `message`); clients filter on `channel`.
 */
export const AppEventSchema = Type.Object(
  { channel: AppEventChannelSchema, data: Type.Unknown() },
  { additionalProperties: false },
);
export type AppEvent = Static<typeof AppEventSchema>;

export const DiagnosticSourceSchema = Type.Union([
  Type.Literal('build'),
  Type.Literal('typecheck'),
  Type.Literal('frontend'),
  Type.Literal('backend'),
  Type.Literal('widget'),
]);
export type DiagnosticSource = Static<typeof DiagnosticSourceSchema>;

/** What the app page's error capture reports (`atdApp` `app.error`), stamped by the shell. */
export const FrontendDiagnosticSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal('error'),
      Type.Literal('unhandledrejection'),
      Type.Literal('console'),
    ]),
    message: Type.String({ maxLength: 4000 }),
    stack: Type.Optional(Type.String({ maxLength: 16000 })),
    /** The version the window had loaded. */
    version: Type.Integer({ minimum: 1 }),
    at: Type.String(),
  },
  { additionalProperties: false },
);
export type FrontendDiagnostic = Static<typeof FrontendDiagnosticSchema>;

/** `POST /v1/apps/:appId/diagnostics` (shell) → 204. */
export const PostAppDiagnosticsRequestSchema = Type.Object(
  { entries: Type.Array(FrontendDiagnosticSchema, { minItems: 1, maxItems: 50 }) },
  { additionalProperties: false },
);
export type PostAppDiagnosticsRequest = Static<typeof PostAppDiagnosticsRequestSchema>;

/**
 * One line of an app's `diagnostics.jsonl` ring, also what the agent's `app.diagnostics` reads.
 * `version` is null for a failed build, which published none. `detail` holds the stack, the
 * compiler output or the backend's stderr excerpt.
 */
export const AppDiagnosticSchema = Type.Object(
  {
    at: Type.String(),
    source: DiagnosticSourceSchema,
    level: Type.Union([Type.Literal('error'), Type.Literal('warning'), Type.Literal('info')]),
    version: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    message: Type.String({ maxLength: 4000 }),
    detail: Type.Optional(Type.String({ maxLength: 16000 })),
  },
  { additionalProperties: false },
);
export type AppDiagnostic = Static<typeof AppDiagnosticSchema>;
