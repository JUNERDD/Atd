import { Value } from 'typebox/value';
import { SettingsItemLinkSchema, type SettingsItemLink } from '../client/settings-contract';

/**
 * Where `openItem` leaves its item for a settings window that is not open yet: the shell opens it
 * at the item's section only, and the windows share the page origin's storage. An open window
 * takes the item from the window message instead and clears this.
 */
const SETTINGS_ITEM_KEY = 'settings.itemTarget';

export function storeSettingsItem(item: SettingsItemLink) {
  try {
    window.localStorage.setItem(SETTINGS_ITEM_KEY, JSON.stringify(item));
  } catch {
    // Without storage a new settings window opens at the item's section instead of its page.
  }
}

/** The item left for this window, once; null when none was left or it does not read as one. */
export function takeSettingsItem(): SettingsItemLink | null {
  try {
    const stored = window.localStorage.getItem(SETTINGS_ITEM_KEY);
    window.localStorage.removeItem(SETTINGS_ITEM_KEY);
    return stored ? settingsItemOf(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

/** A window message's or stored item, checked: other windows may run an older build. */
export function settingsItemOf(value: unknown): SettingsItemLink | null {
  return Value.Check(SettingsItemLinkSchema, value) ? value : null;
}
