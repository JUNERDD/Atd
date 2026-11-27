import { useCallback, useEffect, useRef, useState } from 'react';
import type { BackgroundToOptions, OptionsMessage } from '../messages/options.ts';
import { OPTIONS_PORT } from '../messages/ports.ts';
import type { OptionsView } from '../messages/views.ts';

/** MV3 may stop an idle service worker under an open page; the port is reopened after this. */
const REOPEN_DELAY_MS = 300;

/** The background owns the message's shape; the page only checks that a view arrived. */
function isState(message: unknown): message is BackgroundToOptions {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false;
  return (
    message.type === 'state' &&
    'view' in message &&
    typeof message.view === 'object' &&
    message.view !== null
  );
}

export type SendOption = (message: OptionsMessage) => boolean;

export interface OptionsChannel {
  /** The latest `state` push, null until the first one arrives. */
  view: OptionsView | null;
  /**
   * Posts an intent and says whether it went out. One sent while the port is being reopened is
   * dropped: the reopened port brings a fresh view, and the person can repeat the choice once it
   * shows, so a control shows a choice at once only when it was sent.
   */
  send: SendOption;
}

/**
 * Chrome sends no event when a command shortcut changes, and the person changes them on Chrome's
 * own shortcut page, in another tab: whenever this page shows again or gains focus, it asks the
 * background to read them again.
 */
function useShortcutsRefresh(send: SendOption) {
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') send({ type: 'shortcuts.refresh' });
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [send]);
}

/**
 * The options page's port to the service worker (`OPTIONS_PORT`): the background pushes the page's
 * view on connect and on every change, and the page only sends intents back.
 */
export function useOptionsChannel(): OptionsChannel {
  const [view, setView] = useState<OptionsView | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    let disposed = false;
    let reopen: number | undefined;
    const open = () => {
      const port = chrome.runtime.connect({ name: OPTIONS_PORT });
      portRef.current = port;
      port.onMessage.addListener((message: unknown) => {
        if (isState(message)) setView(message.view);
      });
      port.onDisconnect.addListener(() => {
        // Reading lastError marks it handled, so Chrome logs no unchecked error for the closed port.
        void chrome.runtime.lastError;
        if (portRef.current === port) portRef.current = null;
        if (!disposed) reopen = window.setTimeout(open, REOPEN_DELAY_MS);
      });
    };
    open();
    return () => {
      disposed = true;
      window.clearTimeout(reopen);
      portRef.current?.disconnect();
      portRef.current = null;
    };
  }, []);

  const send = useCallback<SendOption>((message) => {
    const port = portRef.current;
    if (port === null) return false;
    try {
      port.postMessage(message);
      return true;
    } catch {
      // The worker stopped before the port's disconnect arrived: as good as no port.
      return false;
    }
  }, []);
  useShortcutsRefresh(send);

  return { view, send };
}
