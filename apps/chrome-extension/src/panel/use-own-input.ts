import { useCallback, useEffect, useState } from 'react';
import type { OwnInput } from '../channel/payloads.ts';
import { OwnInputRecorder } from '../own-input.ts';

const EVENTS = ['pointerdown', 'keydown', 'wheel'] as const;

/**
 * The person's trusted input on the panel, all of it Atd's own UI. A request sent from here
 * carries what was recorded (`OwnInput`), so the host does not take the key or click that sent it
 * for the person using the page: Chrome is the frontmost app either way. Returns the consumer.
 */
export function useOwnInput(): () => OwnInput | undefined {
  const [recorder] = useState(() => new OwnInputRecorder());
  useEffect(() => {
    const seen = (event: Event): void => {
      if (event.isTrusted) recorder.record(event);
    };
    for (const type of EVENTS)
      document.addEventListener(type, seen, { capture: true, passive: true });
    return () => {
      for (const type of EVENTS) document.removeEventListener(type, seen, { capture: true });
    };
  }, [recorder]);
  return useCallback(() => recorder.take(), [recorder]);
}
