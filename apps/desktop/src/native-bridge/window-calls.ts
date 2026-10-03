/**
 * The native bridge's window and app presence calls (`NativeWindowCalls`, part of `NativeCalls` in
 * `calls.ts`): showing and pinning the panel, the shell's app preferences, and opening the settings
 * and welcome guide windows. Loaded by the export script with Node's type stripping, so it imports
 * nothing but TypeBox and its sibling contract files (by their `.ts` names) and uses only erasable
 * TypeScript syntax.
 */
import { Type, type TSchema } from 'typebox';
import { Empty } from './primitives.ts';

export const NativeWindowCalls = {
  /** Shows and focuses the panel. */
  'window.show': { params: Empty, result: Empty },
  /** Hides the panel (alpha 0; it stays ordered in). */
  'window.hide': { params: Empty, result: Empty },
  'window.setPinned': {
    params: Type.Object({ pinned: Type.Boolean() }, { additionalProperties: false }),
    result: Type.Object({ pinned: Type.Boolean() }, { additionalProperties: false }),
  },
  /** Window and app preferences the shell owns; `openAtLogin` is null where unsupported. */
  'app.state': {
    params: Empty,
    result: Type.Object(
      {
        pinned: Type.Boolean(),
        showInDock: Type.Boolean(),
        openAtLogin: Type.Union([Type.Boolean(), Type.Null()]),
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
} satisfies Record<string, { params: TSchema; result: TSchema }>;
