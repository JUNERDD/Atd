/**
 * The native bridge's window and app presence calls (`NativeWindowCalls`, part of `NativeCalls` in
 * `calls.ts`): showing and pinning the panel, the shell's app preferences, opening the settings,
 * welcome guide and user app windows, and pinning user apps to the desktop. Loaded by the export
 * script with Node's type stripping, so it imports nothing but TypeBox and its sibling contract
 * files (by their `.ts` names) and uses only erasable TypeScript syntax.
 */
import { Type, type TSchema } from 'typebox';
import { Empty } from './primitives.ts';
import { UserAppIdSchema } from './user-app-contract.ts';

/** The widget families a desktop pin draws (agent-contracts `WidgetFamilySchema`). */
const PinFamily = Type.Union([
  Type.Literal('systemSmall'),
  Type.Literal('systemMedium'),
  Type.Literal('systemLarge'),
]);
/** Mirrors agent-contracts `WidgetIdSchema` (this file cannot import the contracts package). */
const PinWidgetId = Type.String({ pattern: '^[a-z][a-z0-9-]{0,31}$' });

/** The most apps the desktop holds pins of; the shell refuses a pin beyond it. */
export const MAX_DESKTOP_PINS = 24;

/**
 * One app's desktop pin as the shell shows it: the declared widget and the family it draws. A
 * null `widgetId` is the app's icon tile, small (icon and name) when `family` is null or
 * `systemSmall`, medium (icon, name and description) when it is `systemMedium`. An app has at
 * most one pin.
 */
export const DesktopPinSchema = Type.Object(
  {
    appId: UserAppIdSchema,
    widgetId: Type.Union([PinWidgetId, Type.Null()]),
    family: Type.Union([PinFamily, Type.Null()]),
  },
  { additionalProperties: false },
);

export const NativeWindowCalls = {
  /** Shows and focuses the panel. */
  'window.show': { params: Empty, result: Empty },
  /** Hides the panel (alpha 0; it stays ordered in). */
  'window.hide': { params: Empty, result: Empty },
  'window.setPinned': {
    params: Type.Object({ pinned: Type.Boolean() }, { additionalProperties: false }),
    result: Type.Object({ pinned: Type.Boolean() }, { additionalProperties: false }),
  },
  /**
   * Window and app preferences the shell owns; `openAtLogin` is null where unsupported.
   * `widgetsAvailable` is false when the app runs outside `/Applications` and `~/Applications`,
   * where macOS does not index the widget extension's App Intents metadata, so its widgets cannot
   * be configured (T1b).
   */
  'app.state': {
    params: Empty,
    result: Type.Object(
      {
        pinned: Type.Boolean(),
        showInDock: Type.Boolean(),
        openAtLogin: Type.Union([Type.Boolean(), Type.Null()]),
        widgetsAvailable: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  'app.setShowInDock': {
    params: Type.Object({ show: Type.Boolean() }, { additionalProperties: false }),
    result: Type.Object({ show: Type.Boolean() }, { additionalProperties: false }),
  },
  /** Resolves to the applied state, false while macOS waits for approval in System Settings. */
  'app.setOpenAtLogin': {
    params: Type.Object({ open: Type.Boolean() }, { additionalProperties: false }),
    result: Type.Object({ open: Type.Boolean() }, { additionalProperties: false }),
  },
  /**
   * Shows the settings window. A first load opens `commandId`'s editor when it is set, else
   * `section` (a settings section id) when that is set; an open window only comes forward, and the
   * page that asked tells it where to go over the window channel.
   */
  'settings.open': {
    params: Type.Object(
      {
        commandId: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
        section: Type.Union([Type.String({ minLength: 1, maxLength: 32 }), Type.Null()]),
      },
      { additionalProperties: false },
    ),
    result: Empty,
  },
  'settings.close': { params: Empty, result: Empty },
  /**
   * Shows the welcome guide: a borderless, transparent window covering the display under the
   * cursor, above the menu bar and the Dock while its full-screen intro plays (activating the app,
   * reusing an open guide), and moves an unpinned panel out of its way. The guide asks for
   * Accessibility in context, so opening it also retires the first-launch Accessibility prompt.
   */
  'onboarding.open': { params: Empty, result: Empty },
  /**
   * The intro ended and the guide's card is in place: the window drops to the normal level, so the
   * panel, the settings window and other apps' windows the guide sends people to show above it.
   */
  'onboarding.settle': { params: Empty, result: Empty },
  /** Closes the welcome guide; `summon` then shows the panel, as its last step's primary action. */
  'onboarding.close': {
    params: Type.Object({ summon: Type.Boolean() }, { additionalProperties: false }),
    result: Empty,
  },
  /**
   * Opens the user app's window, or brings an open one forward; an open window whose loaded
   * version is no longer the app's current one reloads (the shell rereads the app's runtime from
   * the service). Rejects when the service has no such app.
   */
  'userApp.open': {
    params: Type.Object({ appId: UserAppIdSchema }, { additionalProperties: false }),
    result: Empty,
  },
  /** Closes the user app's window; a no-op when it is not open. */
  'userApp.close': {
    params: Type.Object({ appId: UserAppIdSchema }, { additionalProperties: false }),
    result: Empty,
  },
  /**
   * Renders the app widget's latest synced snapshot for one family with the same SwiftUI renderer
   * the widget extension uses, so the renderer can preview widgets without the system gallery.
   * Rejects when the shell has no snapshot for that widget and family.
   */
  'userApp.widgetPreview': {
    params: Type.Object(
      {
        appId: UserAppIdSchema,
        widgetId: Type.String({ minLength: 1, maxLength: 64 }),
        family: Type.Union([
          Type.Literal('systemSmall'),
          Type.Literal('systemMedium'),
          Type.Literal('systemLarge'),
        ]),
      },
      { additionalProperties: false },
    ),
    result: Type.Object({ pngBase64: Type.String() }, { additionalProperties: false }),
  },
  /**
   * Erases the app's web storage (its `WKWebsiteDataStore`): closes its window, releases the web
   * view, then removes the store, retrying while WebKit reports it in use. With `forget`, the app
   * is being deleted, so the shell also drops its content rule list and remembered window frame,
   * and removes its desktop pin. Pairs with the service's data reset
   * (`POST /v1/apps/:appId/clear-data`) or app deletion.
   */
  'userApp.clearData': {
    params: Type.Object(
      { appId: UserAppIdSchema, forget: Type.Boolean() },
      { additionalProperties: false },
    ),
    result: Empty,
  },
  /**
   * Pins the app to the desktop, in the first free place on the display of the window that asked,
   * or changes what its pin shows. `widget` names one of the app's declared widgets and one of its
   * families; null keeps what a pinned app shows, and gives a new pin the app's first widget in its
   * smallest family, or the app's tile when it declares none. Rejects when the app does not exist,
   * the widget or family is not declared, or `MAX_DESKTOP_PINS` apps are pinned already. The new
   * list arrives as `userApp.pins`.
   */
  'userApp.pin': {
    params: Type.Object(
      {
        appId: UserAppIdSchema,
        widget: Type.Union([
          Type.Object(
            { widgetId: PinWidgetId, family: PinFamily },
            { additionalProperties: false },
          ),
          Type.Null(),
        ]),
      },
      { additionalProperties: false },
    ),
    result: Empty,
  },
  /** Removes the app's desktop pin; a no-op when it has none. */
  'userApp.unpin': {
    params: Type.Object({ appId: UserAppIdSchema }, { additionalProperties: false }),
    result: Empty,
  },
} satisfies Record<string, { params: TSchema; result: TSchema }>;
