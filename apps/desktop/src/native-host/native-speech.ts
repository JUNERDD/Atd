import type { SpeechBridge } from '../client/contract';
import type { NativeBridge } from '../native-bridge/client';

/**
 * Reading aloud through the shell. The shell sends `speech.state` on each change and replays it
 * when the page becomes ready; the last value is kept here so a listener that subscribes later
 * (a menu opened mid-speech) starts from the current state.
 */
export function nativeSpeech(native: NativeBridge): SpeechBridge {
  let speaking = false;
  const listeners = new Set<(speaking: boolean) => void>();
  native.on('speech.state', (state) => {
    speaking = state.speaking;
    for (const listener of listeners) listener(speaking);
  });
  return {
    speak: async (text) => void (await native.call('speech.speak', { text })),
    stop: async () => void (await native.call('speech.stop', {})),
    onState(listener) {
      listeners.add(listener);
      listener(speaking);
      return () => listeners.delete(listener);
    },
  };
}
