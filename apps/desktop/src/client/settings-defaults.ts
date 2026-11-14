import { Type, type Static } from 'typebox';
import {
  APP_APPEARANCES,
  APP_LANGUAGES,
  DEFAULT_SHORTCUTS,
  LONG_SCREENSHOT_CONFIRM_ACTIONS,
  VIEW_INITIATIVES,
  type AppAppearance,
  type AppLanguage,
  type ExcludedApp,
  type LongScreenshotConfirmAction,
  type NextStepClick,
  type PanelBackground,
  type PanelGlassVariant,
  type PanelTint,
  type SelectionToolbarActivation,
  type SelectionToolbarIconMode,
  type SelectionToolbarKey,
  type SelectionToolbarPosition,
  type SelectionToolbarSettings,
  type ViewInitiative,
} from '@atd/agent-contracts';

/**
 * One saved item another window shows in Settings, such as a turn's artifact card: a memory or
 * an automation by its id, or a Personal skill, subagent or MCP server by its name (an MCP
 * server's is its server id). Commands keep their own link (`openCommand`).
 */
export const SettingsItemLinkSchema = Type.Union([
  Type.Object(
    { section: Type.Literal('memory'), id: Type.String({ minLength: 1, maxLength: 256 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { section: Type.Literal('automations'), id: Type.String({ minLength: 1, maxLength: 256 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      section: Type.Literal('extensions'),
      kind: Type.Union([Type.Literal('skill'), Type.Literal('agent'), Type.Literal('mcp')]),
      name: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  ),
]);
export type SettingsItemLink = Static<typeof SettingsItemLinkSchema>;

export type ShortcutAction = keyof typeof DEFAULT_SHORTCUTS;
export type ShortcutBindings = Record<ShortcutAction, string>;

/** Languages the UI ships translations for; the list lives in the contracts all clients share. */
export const LANGUAGE_CODES = APP_LANGUAGES;
export { APP_APPEARANCES, resolveLanguage } from '@atd/agent-contracts';
export type {
  AppAppearance,
  AppLanguage,
  ExcludedApp,
  LongScreenshotConfirmAction,
  NextStepClick,
  PanelBackground,
  PanelGlassVariant,
  PanelTint,
  SelectionToolbarActivation,
  SelectionToolbarIconMode,
  SelectionToolbarKey,
  SelectionToolbarPosition,
  SelectionToolbarSettings,
  ViewInitiative,
};
export {
  DEFAULT_COMMAND_TYPING,
  DEFAULT_COMMAND_TYPING_ANIMATION,
  DEFAULT_GLOW_EFFECTS,
  DEFAULT_LONG_SCREENSHOT_CONFIRM_ACTION,
  DEFAULT_NEXT_STEP_CLICK,
  DEFAULT_NEXT_STEPS,
  DEFAULT_PANEL_BACKGROUND,
  DEFAULT_RESULT_MARKDOWN,
  DEFAULT_SCREENSHOT_COPY_ON_CONFIRM,
  DEFAULT_SUMMARY_TITLES,
  DEFAULT_VIEW_INITIATIVE,
  LONG_SCREENSHOT_CONFIRM_ACTIONS,
  SELECTION_TOOLBAR_ACTIVATIONS,
  SELECTION_TOOLBAR_ICON_MODES,
  SELECTION_TOOLBAR_KEYS,
  SELECTION_TOOLBAR_POSITIONS,
  PANEL_GLASS_TUNING_RANGE,
  PANEL_GLASS_VARIANTS,
  PANEL_TINTS,
  PANEL_TONE_RANGE,
  VIEW_INITIATIVES,
} from '@atd/agent-contracts';

/**
 * How the mini panel opens from its pill on the screen edge: as the pointer reaches it, or only on
 * a click (the default), the pointer only swelling the pill. The shell keeps it.
 */
export const MINI_PANEL_OPEN_ON = ['hover', 'click'] as const;
export type MiniPanelOpenOn = (typeof MINI_PANEL_OPEN_ON)[number];

/**
 * Where a summon shows the panel, on the display under the cursor: docked in the bottom-right
 * corner of its work area (the default), centered in it, or where the user last left it on that
 * display, centered until they have. The shell keeps it.
 */
export const PANEL_PLACEMENTS = ['bottomRight', 'center', 'lastPosition'] as const;
export type PanelPlacement = (typeof PANEL_PLACEMENTS)[number];

/** The selection toolbar before the service's settings load, as the service defaults it. */
export const DEFAULT_SELECTION_TOOLBAR: SelectionToolbarSettings = {
  enabled: true,
  excludedApps: [],
  activation: 'hold',
  activationKeys: ['option'],
  showHud: true,
  smallIcon: 'off',
  position: 'pointer',
};

/** Apps the selection toolbar can be kept away from (`SelectionToolbarSettingsSchema`). */
export const MAX_EXCLUDED_APPS = 100;

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export const isAppAppearance = (value: unknown): value is AppAppearance =>
  isOneOf(APP_APPEARANCES, value);
export const isAppLanguage = (value: unknown): value is AppLanguage =>
  isOneOf(LANGUAGE_CODES, value);
export const isViewInitiative = (value: unknown): value is ViewInitiative =>
  isOneOf(VIEW_INITIATIVES, value);
export const isLongScreenshotConfirmAction = (
  value: unknown,
): value is LongScreenshotConfirmAction => isOneOf(LONG_SCREENSHOT_CONFIRM_ACTIONS, value);
