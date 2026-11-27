import type { ShortcutView } from '../messages/views.ts';
import type { Store } from './store.ts';

/** The manifest command that opens the in-page ask. */
export const ASK_COMMAND = 'ask-on-page';

/** Chrome's page for the extensions' command shortcuts, the only place they change. */
const SHORTCUTS_PAGE = 'chrome://extensions/shortcuts';

/**
 * Reads the extension's commands again, in Chrome's order, with their shortcuts as Chrome shows
 * them (the person may change them). Chrome sends no event for a change, so this runs whenever a
 * page that shows them may show one: at boot, when a panel or options page opens, and when the
 * options page asks. A failed read keeps the list read last.
 */
export async function refreshShortcuts(store: Store): Promise<void> {
  const commands = await chrome.commands.getAll().catch(() => undefined);
  if (commands === undefined) return;
  const shortcuts = commands.flatMap(({ name, shortcut, description }): ShortcutView[] =>
    name === undefined ? [] : [{ name, shortcut: shortcut ?? '', description: description ?? '' }],
  );
  if (JSON.stringify(shortcuts) !== JSON.stringify(store.state.shortcuts)) {
    store.update({ shortcuts });
  }
}

/** The ask command's shortcut in `shortcuts`, '' when it has none. */
export function askShortcut(shortcuts: readonly ShortcutView[]): string {
  return shortcuts.find((command) => command.name === ASK_COMMAND)?.shortcut ?? '';
}

/**
 * Change Shortcuts: Chrome's shortcut page in a new tab, right after `beside` (the options page's
 * own tab) when there is one. Only the extension can open it: a page's link cannot open a
 * chrome:// URL, and no fragment of it focuses one extension.
 */
export async function openShortcutSettings(beside: chrome.tabs.Tab | undefined): Promise<void> {
  const placement =
    beside?.id === undefined
      ? {}
      : { windowId: beside.windowId, index: beside.index + 1, openerTabId: beside.id };
  try {
    await chrome.tabs.create({ url: SHORTCUTS_PAGE, active: true, ...placement });
  } catch (error) {
    console.info('[atd] could not open the shortcut settings', error);
  }
}
