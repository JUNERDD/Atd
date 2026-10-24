import { useLayoutEffect, useRef } from 'react';
import { useHotkeys, type Options } from 'react-hotkeys-hook';
import { isComposingKey } from '@atd/ui/lib/ime';
import { acceleratorToHotkey } from '../../../lib/shortcuts';

/** The accelerators that move to the previous and next user message. */
export const PREVIOUS_MESSAGE = 'Alt+CommandOrControl+Up';
export const NEXT_MESSAGE = 'Alt+CommandOrControl+Down';

/** Like the panel's own keys: heard in the composer too, once per press. */
const STEP_KEYS: Options = {
  delimiter: '|',
  useKey: false,
  enableOnFormTags: true,
  enableOnContentEditable: true,
  preventDefault: true,
  ignoreEventWhen: (event) => event.defaultPrevented || event.repeat || isComposingKey(event),
};

/**
 * Binds the keys that step to the previous or next user message while the conversation is shown
 * (`enabled`). They stay bound across renders; each press steps with the latest `onStep`.
 */
export function usePromptStepKeys(enabled: boolean, onStep: (direction: -1 | 1) => void) {
  const platform = window.desktop?.platform ?? 'web';
  const step = useRef(onStep);
  useLayoutEffect(() => {
    step.current = onStep;
  });
  const keys = { ...STEP_KEYS, enabled };
  useHotkeys(acceleratorToHotkey(PREVIOUS_MESSAGE, platform), () => step.current(-1), keys, []);
  useHotkeys(acceleratorToHotkey(NEXT_MESSAGE, platform), () => step.current(1), keys, []);
}
