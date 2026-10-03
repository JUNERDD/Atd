import { Type, type Static } from 'typebox';
import { PermissionTierSchema } from './confirms.js';
import { Identifier } from './identifiers.js';
import { ShellAllowlistSchema } from './shell.js';

/**
 * Workspace-level contracts every client shares: the user settings the service owns, the browser
 * session handshake, and the stream frame that tells clients which shared data changed.
 */

/** Languages the clients ship translations for. English is the source language. */
export const APP_LANGUAGES = ['en', 'zh-CN'] as const;
/** Kept literal so the static type stays a union; update it together with `APP_LANGUAGES`. */
export type AppLanguage = (typeof APP_LANGUAGES)[number];
export const AppLanguageSchema = Type.Union([Type.Literal('en'), Type.Literal('zh-CN')]);

const AcceleratorSchema = Type.String({ minLength: 1, maxLength: 100 });

/**
 * Application shortcut bindings. The accelerator grammar lives in `shortcuts.ts`; clients validate
 * it before saving, and the desktop owns global registration.
 */
export const ShortcutBindingsSchema = Type.Object(
  {
    togglePanel: AcceleratorSchema,
    captureScreenshot: AcceleratorSchema,
    newConversation: AcceleratorSchema,
    openSettings: AcceleratorSchema,
    sendMessage: AcceleratorSchema,
    newLine: AcceleratorSchema,
  },
  { additionalProperties: false },
);
export type ShortcutBindingsWire = Static<typeof ShortcutBindingsSchema>;

/** An app the selection toolbar never appears over, as the app picker named it. */
export const ExcludedAppSchema = Type.Object(
  {
    bundleId: Type.String({ minLength: 1, maxLength: 255 }),
    name: Type.String({ minLength: 1, maxLength: 255 }),
  },
  { additionalProperties: false },
);
export type ExcludedApp = Static<typeof ExcludedAppSchema>;

/**
 * The toolbar the shell shows over text selected in other apps. Defaults to
 * `{ enabled: true, excludedApps: [] }`; a patch replaces the whole value.
 */
export const SelectionToolbarSettingsSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    excludedApps: Type.Array(ExcludedAppSchema, { maxItems: 100 }),
  },
  { additionalProperties: false },
);
export type SelectionToolbarSettings = Static<typeof SelectionToolbarSettingsSchema>;

/**
 * Settings every client applies the same way. `language: null` means the client resolves one
 * from its locale; `shortcuts: null` means the defaults.
 */
export const UserSettingsSchema = Type.Object(
  {
    language: Type.Union([AppLanguageSchema, Type.Null()]),
    /** Tier a new task freezes at creation; existing tasks keep their own. */
    permissionTier: PermissionTierSchema,
    /** The user shell allowlist, in the user's order; the operator env list is never included. */
    shellAllowlist: ShellAllowlistSchema,
    shortcuts: Type.Union([ShortcutBindingsSchema, Type.Null()]),
    selectionToolbar: SelectionToolbarSettingsSchema,
    /** The first desktop launch on this data dir showed the welcome guide. */
    onboardingCompleted: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type UserSettings = Static<typeof UserSettingsSchema>;

/**
 * `initialized` stays false until some client writes settings, so the first desktop client can
 * seed the service from the settings it stored before the service owned them.
 */
export const SettingsResponseSchema = Type.Object(
  {
    settings: UserSettingsSchema,
    revision: Type.Integer({ minimum: 0 }),
    initialized: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type SettingsResponse = Static<typeof SettingsResponseSchema>;

/** `PATCH /v1/settings`: listed fields replace the stored ones. */
export const PatchSettingsRequestSchema = Type.Object(
  {
    language: Type.Optional(Type.Union([AppLanguageSchema, Type.Null()])),
    permissionTier: Type.Optional(PermissionTierSchema),
    shellAllowlist: Type.Optional(ShellAllowlistSchema),
    shortcuts: Type.Optional(Type.Union([ShortcutBindingsSchema, Type.Null()])),
    selectionToolbar: Type.Optional(SelectionToolbarSettingsSchema),
    onboardingCompleted: Type.Optional(Type.Boolean()),
    /** Seeding: apply only while the settings are uninitialized, else answer the current ones. */
    onlyIfUninitialized: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type PatchSettingsRequest = Static<typeof PatchSettingsRequestSchema>;

/** Subprotocol every stream client offers; the service selects it on upgrade. */
export const STREAM_PROTOCOL = 'ai.v1';
/** Prefix of the subprotocol that carries the service token (`WebSocket` cannot set headers). */
export const STREAM_AUTH_PROTOCOL_PREFIX = 'ai.auth.';

export const InvalidateScopeSchema = Type.Union([
  Type.Literal('settings'),
  Type.Literal('commands'),
  Type.Literal('providers'),
  /** Skills, roles, subagents, built-ins and MCP servers. */
  Type.Literal('extensions'),
  Type.Literal('memory'),
  /** A task's title or tier changed; `taskId` names it. */
  Type.Literal('task'),
  /** A task was deleted; `taskId` names it. */
  Type.Literal('task.deleted'),
]);
export type InvalidateScope = Static<typeof InvalidateScopeSchema>;

/**
 * Stream frame sent to every connection after shared data changed, whoever changed it. Clients
 * reload the named scope over HTTP; the frame carries no data so it cannot go stale.
 */
export const InvalidateFrameSchema = Type.Object(
  {
    type: Type.Literal('invalidate'),
    scope: InvalidateScopeSchema,
    taskId: Type.Optional(Identifier),
  },
  { additionalProperties: false },
);
export type InvalidateFrame = Static<typeof InvalidateFrameSchema>;
