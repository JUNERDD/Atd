import { useCallback, useEffect, useRef, useState } from 'react';
import type { BackgroundToPopup, PopupMessage } from '../messages/popup.ts';
import { POPUP_PORT } from '../messages/ports.ts';
import type { PopupView } from '../messages/views.ts';

/** MV3 may stop an idle service worker under an open popup; the port is reopened after this. */
const REOPEN_DELAY_MS = 300;

/** The background owns the view's shape; the popup only checks that a message is a state push. */
function isStatePush(message: unknown): message is BackgroundToPopup {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'state' &&
    'view' in message &&
    typeof message.view === 'object' &&
    message.view !== null
  );
}

/**
 * The popup's port to the service worker (`POPUP_PORT`). `view` is the latest `state` push, null
 * until the first one arrives. `send` posts an intent; one sent while the port is being reopened
 * is dropped, as the person can repeat it once the view returns.
 */
export function usePopupChannel(): {
  view: PopupView | null;
  send: (message: PopupMessage) => void;
} {
  const [view, setView] = useState<PopupView | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    let disposed = false;
    let reopen: number | undefined;
    const open = () => {
      const port = chrome.runtime.connect({ name: POPUP_PORT });
      portRef.current = port;
      port.onMessage.addListener((message: unknown) => {
        if (isStatePush(message)) setView(message.view);
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

  const send = useCallback((message: PopupMessage) => {
    portRef.current?.postMessage(message);
  }, []);

  return { view, send };
}
