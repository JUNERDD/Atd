import type { CaptureBridge, CaptureTextBridge } from '../client/capture-bridge';
import type { EventPayload, NativeBridge } from '../native-bridge/client';

type CaptureEvent =
  | 'shortcut.screenshot'
  | 'recording.ask'
  | 'recording.askStop'
  | 'recording.askOpen'
  | 'captureText.run'
  | 'captureText.action';

/** What the capture events hand the page before the host knows the commands to prepare. */
export type CaptureEvents = Pick<CaptureBridge, 'onShortcut' | 'recordingAsks'> & {
  captureText: Omit<CaptureTextBridge, 'prepare'>;
};

/**
 * Capture shortcuts, result card questions and runs on screenshot text can arrive before React
 * mounts their consumer.
 */
function heldEvent<E extends CaptureEvent>(native: NativeBridge, event: E) {
  const waiting: EventPayload<E>[] = [];
  const listeners = new Set<(value: EventPayload<E>) => void>();
  native.on(event, (value) => {
    if (!listeners.size) waiting.push(value);
    else for (const listener of listeners) listener(value);
  });
  return (listener: (value: EventPayload<E>) => void) => {
    listeners.add(listener);
    for (const value of waiting.splice(0)) listener(value);
    return () => void listeners.delete(listener);
  };
}

/** Subscribe before host installation awaits, preserving every question, run and their actions. */
export function nativeCaptureEvents(native: NativeBridge): CaptureEvents {
  const onShortcut = heldEvent(native, 'shortcut.screenshot');
  const onAsk = heldEvent(native, 'recording.ask');
  const onStop = heldEvent(native, 'recording.askStop');
  const onOpen = heldEvent(native, 'recording.askOpen');
  return {
    onShortcut: (listener) => onShortcut(({ mode }) => listener(mode)),
    recordingAsks: {
      onAsk,
      onStop: (listener) => onStop(({ askId }) => listener(askId)),
      onOpen: (listener) => onOpen(({ askId }) => listener(askId)),
      answer: async (answer) => void (await native.call('recording.answer', answer)),
    },
    captureText: {
      onRun: heldEvent(native, 'captureText.run'),
      onAction: heldEvent(native, 'captureText.action'),
      progress: async (progress) => void (await native.call('captureText.progress', progress)),
    },
  };
}
