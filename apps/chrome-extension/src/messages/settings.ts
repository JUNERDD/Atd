import { Type, type Static } from 'typebox';

/**
 * The extension's own settings, which its options page changes. Everything else the surfaces
 * follow belongs to Atd (`ChromePrefs`: language and glow effects, D13) or to Chrome (the command
 * shortcuts, which only `chrome://extensions/shortcuts` changes). The background owns them: it
 * restores them from `chrome.storage.local` (`STORAGE_KEYS.settings`), validates what it restores
 * and what the options page sends, persists every change, and applies it.
 */

/**
 * What a click on the toolbar button does where the browser has Chrome's side panel. `ask`: the
 * in-page ask in the tab, or the panel in the side panel on a tab no content script can run in.
 * `panel`: the panel in the side panel, on every tab. Where a browser has no side panel API, the
 * button's popup is the panel whatever this says. The ask shortcut always opens the in-page ask.
 */
export const ToolbarActionSchema = Type.Union([Type.Literal('ask'), Type.Literal('panel')]);
export type ToolbarAction = Static<typeof ToolbarActionSchema>;

export const ExtensionSettingsSchema = Type.Object({ toolbarAction: ToolbarActionSchema });
export type ExtensionSettings = Static<typeof ExtensionSettingsSchema>;

/** The settings before the person changed any; a stored value missing a setting takes it from here. */
export const DEFAULT_SETTINGS: ExtensionSettings = { toolbarAction: 'ask' };
