import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { STORAGE_KEYS } from '../messages/ports.ts';
import {
  DEFAULT_SETTINGS,
  ExtensionSettingsSchema,
  type ExtensionSettings,
} from '../messages/settings.ts';
import { applyToolbarAction } from './action-surface.ts';
import type { Store } from './store.ts';

/**
 * The extension's own settings (`ExtensionSettings`), which the background owns: restored at
 * boot, changed only by the options page, kept in `chrome.storage.local` and applied to Chrome as
 * soon as they are known. The store holds them for the views; nothing else changes them.
 */

/** Whatever object was stored, read one setting at a time. */
const StoredSchema = Type.Record(Type.String(), Type.Unknown());

/** Restores the settings an earlier session kept, then applies them (worker boot). */
export async function restoreSettings(store: Store): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  adopt(store, fromStored(stored[STORAGE_KEYS.settings]));
}

/** A change from the options page: shown, kept and applied at once. */
export function changeSettings(store: Store, patch: Partial<ExtensionSettings>): void {
  const settings: ExtensionSettings = { ...store.state.settings, ...patch };
  adopt(store, settings);
  chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings }).catch((error: unknown) => {
    console.warn('[atd] could not keep the settings', error);
  });
}

function adopt(store: Store, settings: ExtensionSettings): void {
  store.update({ settings });
  applyToolbarAction(settings.toolbarAction);
}

/**
 * The stored settings, checked one setting at a time: a setting the stored value lacks, or holds
 * in a form this version does not accept, takes its default, and the others keep what the person
 * chose.
 */
function fromStored(value: unknown): ExtensionSettings {
  const stored: Record<string, unknown> = Value.Check(StoredSchema, value) ? value : {};
  const { properties } = ExtensionSettingsSchema;
  return {
    toolbarAction: setting(
      properties.toolbarAction,
      stored['toolbarAction'],
      DEFAULT_SETTINGS.toolbarAction,
    ),
  };
}

function setting<Schema extends TSchema>(
  schema: Schema,
  value: unknown,
  fallback: Static<Schema>,
): Static<Schema> {
  return Value.Check(schema, value) ? value : fallback;
}
