import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { history, historyKeymap, insertNewline, standardKeymap } from '@codemirror/commands';
import { matchesAccelerator } from '../../lib/shortcuts';
import type { QuickPanelHandle } from '../quick-panel/use-quick-panel';

/** What key routing reads from React; every call returns the latest rendered value. */
export interface KeyRouting {
  panel(): QuickPanelHandle | null;
  shortcuts(): { sendMessage: string; newLine: string };
  platform: string;
  send(): void;
}

/** Plain Enter inserts a newline like a textarea when no shortcut claims it, never mid-composition. */
const newline = (view: EditorView) => !view.compositionStarted && insertNewline(view);

function composingKey(event: KeyboardEvent, view: EditorView): boolean {
  return event.isComposing || event.keyCode === 229 || view.composing;
}

/**
 * An open quick panel takes unmodified ↑/↓/Enter/Tab; false leaves the key to the editor (the
 * panel is closed or has nothing to select). Keys of an IME composition never reach the panel.
 */
export function routePanelKey(
  event: KeyboardEvent,
  view: EditorView,
  panel: QuickPanelHandle | null,
): boolean {
  if (!panel || composingKey(event, view)) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    return panel.move(event.key === 'ArrowUp' ? -1 : 1);
  return (event.key === 'Enter' || event.key === 'Tab') && panel.select();
}

/**
 * Keys reach the composer in one order: an IME composition keeps every key; an open quick panel
 * takes ↑/↓/Enter/Tab; then the user's send and newline shortcuts, matched on physical keys like
 * the rest of the panel's shortcuts. Esc is never bound here: the quick panel's popover or the
 * panel-level handler owns it.
 */
function routeKey(event: KeyboardEvent, view: EditorView, routing: KeyRouting): boolean {
  if (composingKey(event, view)) return false;
  if (routePanelKey(event, view, routing.panel())) return true;
  const { sendMessage, newLine } = routing.shortcuts();
  if (matchesAccelerator(event, sendMessage, routing.platform)) {
    // Holding the key never repeats a send; the default newline stays suppressed.
    if (!event.repeat) routing.send();
    return true;
  }
  if (matchesAccelerator(event, newLine, routing.platform)) return insertNewline(view);
  return false;
}

/**
 * History plus the standard editing keys without `defaultKeymap`, whose Esc binding
 * (`simplifySelection`) would swallow the panel's Esc and whose Mod-f and Tab bindings do not
 * belong in a prompt field.
 */
export function composerKeys(routing: KeyRouting) {
  return [
    history(),
    Prec.highest(
      EditorView.domEventHandlers({ keydown: (event, view) => routeKey(event, view, routing) }),
    ),
    keymap.of([
      ...standardKeymap.filter((binding) => binding.key !== 'Enter'),
      { key: 'Enter', run: newline, shift: newline },
      ...historyKeymap,
    ]),
  ];
}
