import { useEffect, useLayoutEffect, useRef } from 'react';
import { isComposingKey } from '@ai/ui/lib/ime';

/** ⌘ plus these keys run the window's actions, as in the macOS apps that have them. */
const ACTIONS = { f: 'search', '[': 'back', ']': 'forward' } as const;

type Action = (typeof ACTIONS)[keyof typeof ACTIONS];

/** Text inputs keep their own editing keys; CodeMirror uses ⌘[ and ⌘] to indent. */
const TEXT_ENTRY =
  'input:is(:not([type]), [type="text"], [type="search"], [type="url"], [type="email"], [type="password"], [type="number"]), textarea, select, [contenteditable]:not([contenteditable="false"])';

/** Dialogs own the keyboard while open; the settings drawer is the navigation itself. */
const MODAL = '[role="alertdialog"], [role="dialog"]:not(.settings-drawer)';

function actionOf(event: KeyboardEvent): Action | null {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  return key in ACTIONS ? ACTIONS[key as keyof typeof ACTIONS] : null;
}

/**
 * The settings window's keyboard commands: ⌘F focuses the settings search, ⌘[ and ⌘] step Back
 * and Forward through the shown section's pages. They leave alone a key a control already handled
 * (`defaultPrevented`), keys typed into a text field or an open dialog, and every key while
 * `disabled` (a shortcut is being recorded).
 */
export function useSettingsKeys(disabled: boolean, actions: Record<Action, () => void>) {
  const latest = useRef({ disabled, actions });
  useLayoutEffect(() => {
    latest.current = { disabled, actions };
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isComposingKey(event) || latest.current.disabled) return;
      const action = actionOf(event);
      if (!action) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(TEXT_ENTRY) || target?.closest(MODAL)) return;
      event.preventDefault();
      latest.current.actions[action]();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
