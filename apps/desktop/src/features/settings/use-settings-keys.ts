import { useHotkeys } from 'react-hotkeys-hook';
import { isComposingKey } from '@ai/ui/lib/ime';

/** ⌘ plus these keys run the window's actions, as in the macOS apps that have them. */
const ACTIONS = { f: 'search', '[': 'back', ']': 'forward' } as const;

type Action = (typeof ACTIONS)[keyof typeof ACTIONS];

/** Text inputs keep their own editing keys; CodeMirror uses ⌘[ and ⌘] to indent. */
const TEXT_ENTRY =
  'input:is(:not([type]), [type="text"], [type="search"], [type="url"], [type="email"], [type="password"], [type="number"]), textarea, select, [contenteditable]:not([contenteditable="false"])';

/** Dialogs own the keyboard while open; the settings drawer is the navigation itself. */
const MODAL = '[role="alertdialog"], [role="dialog"]:not(.settings-drawer)';

const isAction = (key: string | undefined): key is keyof typeof ACTIONS =>
  key !== undefined && Object.hasOwn(ACTIONS, key);

/** A key a control already handled, one an IME is composing, or one typed into text or a dialog. */
function ignored(event: KeyboardEvent) {
  if (event.defaultPrevented || isComposingKey(event)) return true;
  const target = event.target instanceof Element ? event.target : null;
  return Boolean(target?.closest(TEXT_ENTRY) || target?.closest(MODAL));
}

/**
 * The settings window's keyboard commands: ⌘F focuses the settings search, ⌘[ and ⌘] step Back
 * and Forward through the shown section's pages. Only ⌘ counts (another modifier with it is a
 * different shortcut), matched by the key it types. They leave alone a key a control already
 * handled (`defaultPrevented`), keys typed into a text field or an open dialog, and every key
 * while `disabled` (a shortcut is being recorded). Other form controls (switches, buttons) still
 * take them.
 */
export function useSettingsKeys(disabled: boolean, actions: Record<Action, () => void>) {
  useHotkeys(
    ['meta+f', 'meta+[', 'meta+]'],
    (_event, hotkey) => {
      const key = hotkey.keys?.[0];
      if (isAction(key)) actions[ACTIONS[key]]();
    },
    {
      enabled: !disabled,
      enableOnFormTags: true,
      ignoreEventWhen: ignored,
      preventDefault: true,
      useKey: true,
    },
  );
}
