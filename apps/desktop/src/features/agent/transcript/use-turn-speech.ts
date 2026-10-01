import { useEffect, useSyncExternalStore } from 'react';
import type { SpeechBridge } from '../../../client/contract';

/**
 * The turn whose answer the shell reads aloud. The shell reads one text at a time, so this is one
 * value for the whole transcript: starting another turn replaces it, and the shell's `speaking`
 * turning false (finished, stopped or failed) clears it.
 */
let reading: string | null = null;
const listeners = new Set<() => void>();
let following: SpeechBridge | null = null;
/**
 * `speech.speak` calls not answered yet. The text being replaced can end just before the shell
 * takes the new one, and its `speaking: false` must not clear the turn that asked; the call is
 * answered once the new text is queued, before it can end.
 */
let starting = 0;

function setReading(next: string | null) {
  reading = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Follows the shell's state once per bridge; a page lives with one bridge. */
function follow(speech: SpeechBridge) {
  if (following === speech) return;
  following = speech;
  speech.onState((speaking) => {
    if (!speaking && starting === 0) setReading(null);
  });
}

/**
 * Read aloud for one turn's answer: `reading` while the shell reads this turn, and `toggle` to
 * start (replacing any other turn) or stop. Null without the shell's speech or a text to read.
 */
export function useTurnSpeech(turnId: string, text: string) {
  const speech = window.desktop?.speech;
  const active = useSyncExternalStore(subscribe, () => reading === turnId);
  useEffect(() => {
    if (speech) follow(speech);
  }, [speech]);
  if (!speech || !text.trim()) return null;
  return {
    reading: active,
    async toggle() {
      if (active) {
        await speech.stop();
        return;
      }
      setReading(turnId);
      starting += 1;
      try {
        await speech.speak(text);
      } catch (error) {
        setReading(null);
        throw error;
      } finally {
        starting -= 1;
      }
    },
  };
}
