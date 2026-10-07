import { useLayoutEffect, useRef } from 'react';
import { useHotkeys, type Options } from 'react-hotkeys-hook';
import type { ShortcutBindings } from '../../client/settings-contract';
import { isComposingKey } from '@atd/ui/lib/ime';
import { acceleratorToHotkey } from '../../lib/shortcuts';

const OPTIONS: Options = {
  delimiter: '|',
  useKey: false,
  enableOnFormTags: true,
  enableOnContentEditable: true,
  preventDefault: true,
  enabled: (event) => !event.repeat,
  ignoreEventWhen: (event) => event.defaultPrevented || isComposingKey(event),
};

/**
 * The panel's own keys while it has focus: the Settings and New conversation shortcuts, and
 * Escape, which steps back one level per press (`escape` decides which). An Escape a control
 * already handled, such as a closing menu, never reaches it.
 */
export function usePanelHotkeys(
  shortcuts: Pick<ShortcutBindings, 'openSettings' | 'newConversation'>,
  actions: { openSettings: () => void; newConversation: () => void; escape: () => void },
): void {
  const platform = window.desktop?.platform ?? 'web';
  // The keys stay bound across renders; each press runs the actions of the latest one.
  const latest = useRef(actions);
  useLayoutEffect(() => {
    latest.current = actions;
  });
  useHotkeys(
    acceleratorToHotkey(shortcuts.openSettings, platform),
    () => latest.current.openSettings(),
    OPTIONS,
    [],
  );
  useHotkeys(
    acceleratorToHotkey(shortcuts.newConversation, platform),
    () => latest.current.newConversation(),
    OPTIONS,
    [],
  );
  useHotkeys(
    'escape',
    () => latest.current.escape(),
    { ...OPTIONS, ignoreModifiers: true, preventDefault: false },
    [],
  );
}
