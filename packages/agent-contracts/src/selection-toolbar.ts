import { Type, type Static } from 'typebox';

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
 * When a selection brings up the toolbar: any selection (`always`), only one made while every
 * key of `activationKeys` is held (`hold`), or any selection while the shell listens, which
 * pressing that combination twice on its own turns on and off (`toggle`; off at every launch).
 */
export const SELECTION_TOOLBAR_ACTIVATIONS = ['always', 'hold', 'toggle'] as const;
export type SelectionToolbarActivation = (typeof SELECTION_TOOLBAR_ACTIVATIONS)[number];
export const SelectionToolbarActivationSchema = Type.Union([
  Type.Literal('always'),
  Type.Literal('hold'),
  Type.Literal('toggle'),
]);

/**
 * A modifier `hold` and `toggle` watch; either side's key counts. Control is not one: Control-click
 * is a secondary click on macOS, so a selection cannot be dragged while it is held.
 */
export const SELECTION_TOOLBAR_KEYS = ['option', 'command', 'shift'] as const;
export type SelectionToolbarKey = (typeof SELECTION_TOOLBAR_KEYS)[number];
export const SelectionToolbarKeySchema = Type.Union([
  Type.Literal('option'),
  Type.Literal('command'),
  Type.Literal('shift'),
]);

/**
 * What a selection brings up first, whatever the activation: the whole toolbar (`off`), or a
 * small icon by the pointer that grows into the toolbar where it stands, on a click (`click`) or
 * once the pointer rests on it (`hover`); a pointer passing over it does not.
 */
export const SELECTION_TOOLBAR_ICON_MODES = ['click', 'hover', 'off'] as const;
export type SelectionToolbarIconMode = (typeof SELECTION_TOOLBAR_ICON_MODES)[number];
export const SelectionToolbarIconModeSchema = Type.Union([
  Type.Literal('click'),
  Type.Literal('hover'),
  Type.Literal('off'),
]);

/**
 * Where the whole toolbar appears when a selection brings it up at once (`smallIcon: 'off'`):
 * centered on the pointer, on the side of the selection away from it, so it never covers selected
 * text (`pointer`); or centered on the selection, above it (`above`) or below it (`below`). Each
 * takes the other side when its own has no room. The small icon always sits by the pointer.
 */
export const SELECTION_TOOLBAR_POSITIONS = ['pointer', 'above', 'below'] as const;
export type SelectionToolbarPosition = (typeof SELECTION_TOOLBAR_POSITIONS)[number];
export const SelectionToolbarPositionSchema = Type.Union([
  Type.Literal('pointer'),
  Type.Literal('above'),
  Type.Literal('below'),
]);

/**
 * The toolbar the shell shows over text selected in other apps. Defaults to `{ enabled: true,
 * excludedApps: [], activation: 'hold', activationKeys: ['option'], showHud: true, smallIcon:
 * 'off', position: 'pointer' }`; a patch replaces the whole value. `activationKeys` is a
 * combination: each key at most once. `showHud`: in the `toggle` mode, the shell shows a status
 * HUD while it listens.
 */
export const SelectionToolbarSettingsSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    excludedApps: Type.Array(ExcludedAppSchema, { maxItems: 100 }),
    activation: SelectionToolbarActivationSchema,
    activationKeys: Type.Array(SelectionToolbarKeySchema, {
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
    }),
    showHud: Type.Boolean(),
    smallIcon: SelectionToolbarIconModeSchema,
    position: SelectionToolbarPositionSchema,
  },
  { additionalProperties: false },
);
export type SelectionToolbarSettings = Static<typeof SelectionToolbarSettingsSchema>;
