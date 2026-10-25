import type { NativeBridge } from '../native-bridge/client';

/** Each recorder owns a native session; a late release never resumes another recorder. */
export function nativeShortcutRecording(native: NativeBridge): () => Promise<() => void> {
  let nextSession = 0;
  return async () => {
    const session = ++nextSession;
    const release = () => {
      void native
        .call('shortcuts.recording', { session, active: false })
        .catch((error: unknown) => {
          console.error('The native shortcut recording could not end:', error);
        });
    };
    try {
      await native.call('shortcuts.recording', { session, active: true });
      return release;
    } catch (error) {
      // A rejected/invalid acknowledgement must not leave a session held by the shell.
      release();
      throw error;
    }
  };
}
