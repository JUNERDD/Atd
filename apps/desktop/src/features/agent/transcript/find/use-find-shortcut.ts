import { useLayoutEffect, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { isComposingKey } from '@atd/ui/lib/ime';
import { acceleratorToHotkey } from '../../../../lib/shortcuts';

/** The accelerator that opens the find bar, or focuses it again while open. */
export const FIND_ACCELERATOR = 'CommandOrControl+F';

/**
 * Binds the find key while the conversation is shown (`enabled`). Like the panel's own keys it is
 * heard in the composer and the find field too, once per press; each press calls the latest
 * `onOpen`.
 */
export function useFindShortcut(enabled: boolean, onOpen: () => void) {
  const platform = window.desktop?.platform ?? 'web';
  const open = useRef(onOpen);
  useLayoutEffect(() => {
    open.current = onOpen;
  });
  useHotkeys(
    acceleratorToHotkey(FIND_ACCELERATOR, platform),
    () => open.current(),
    {
      delimiter: '|',
      useKey: false,
      enabled,
      enableOnFormTags: true,
      enableOnContentEditable: true,
      preventDefault: true,
      ignoreEventWhen: (event) => event.defaultPrevented || event.repeat || isComposingKey(event),
    },
    [],
  );
}
