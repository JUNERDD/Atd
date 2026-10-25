import { useEffect } from 'react';
import { isComposingKey } from '@atd/ui/lib/ime';
import { onWindowActive } from '../../window-state';

/** Shared cancellation and input-method boundaries for shortcut and toolbar-key recording. */
export function useRecordingBoundaries(
  recording: boolean,
  cancel: () => void,
  isPending: () => boolean,
) {
  useEffect(() => {
    if (!recording) return;
    function guard(event: KeyboardEvent) {
      if (event.key === 'Tab' || event.key === 'Escape') {
        cancel();
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      } else if (event.repeat || isComposingKey(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    window.addEventListener('keydown', guard, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('error', cancel);
    window.addEventListener('unhandledrejection', cancel);
    // WebKit focuses the recorder pill only after recording starts. Leaving it while native
    // suspension is pending must cancel too, without cancelling that later automatic focus.
    const cancelPending = () => {
      if (isPending()) cancel();
    };
    window.addEventListener('pointerdown', cancelPending, true);
    window.addEventListener('focusout', cancelPending, true);
    const unsubscribe = onWindowActive((active) => {
      if (!active) cancel();
    });
    return () => {
      window.removeEventListener('keydown', guard, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('error', cancel);
      window.removeEventListener('unhandledrejection', cancel);
      window.removeEventListener('pointerdown', cancelPending, true);
      window.removeEventListener('focusout', cancelPending, true);
      unsubscribe();
    };
  }, [cancel, isPending, recording]);
}
