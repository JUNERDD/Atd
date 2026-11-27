import { useCallback, useEffect, useRef, useState } from 'react';
import type { BackgroundToPanel, PanelMessage } from '../messages/panel.ts';
import { PANEL_PORT } from '../messages/ports.ts';
import type { AskStatus, PanelView } from '../messages/views.ts';
import { usePageDiagnostics } from '../pages/use-page-diagnostics.ts';

/** MV3 may stop an idle service worker under an open panel; the port is reopened after this. */
const REOPEN_DELAY_MS = 300;

/** The background owns the messages' shapes; the panel only checks which kind arrived. */
function isMessage(message: unknown): message is BackgroundToPanel {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false;
  if (message.type === 'state')
    return 'view' in message && typeof message.view === 'object' && message.view !== null;
  return message.type === 'ask.status' && 'requestId' in message && 'state' in message;
}

export type AskStatusListener = (status: AskStatus) => void;

export interface PanelChannel {
  /** The latest `state` push, null until the first one arrives. */
  view: PanelView | null;
  /**
   * Posts an intent. One sent while the port is being reopened is dropped, as the person can
   * repeat it once the view returns; an ask fails at once instead.
   */
  send: (message: PanelMessage) => void;
  /** Subscribes to Atd's answers to this panel's asks; returns the unsubscribe. */
  onAskStatus: (listener: AskStatusListener) => () => void;
}

/**
 * The panel's port to the service worker (`PANEL_PORT`). An ask waits for its answer on the port
 * it went out on: when that port closes first (the worker stopped), no answer can come, so the ask
 * fails as not connected and its draft stays for the person to send again.
 */
export function usePanelChannel(): PanelChannel {
  const [view, setView] = useState<PanelView | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const listeners = useRef(new Set<AskStatusListener>());
  const asking = useRef(new Set<string>());

  const answer = useCallback((status: AskStatus) => {
    if (!asking.current.delete(status.requestId)) return;
    for (const listener of listeners.current) listener(status);
  }, []);

  const failAsking = useCallback(() => {
    // `answer` deletes each id as it goes, which a Set's iteration allows.
    for (const requestId of asking.current)
      answer({ type: 'ask.status', requestId, state: 'failed', reason: 'notConnected' });
  }, [answer]);

  useEffect(() => {
    let disposed = false;
    let reopen: number | undefined;
    const open = () => {
      const port = chrome.runtime.connect({ name: PANEL_PORT });
      portRef.current = port;
      port.onMessage.addListener((message: unknown) => {
        if (!isMessage(message)) return;
        if (message.type === 'state') setView(message.view);
        else answer(message);
      });
      port.onDisconnect.addListener(() => {
        // Reading lastError marks it handled, so Chrome logs no unchecked error for the closed port.
        void chrome.runtime.lastError;
        if (portRef.current === port) portRef.current = null;
        failAsking();
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
  }, [answer, failAsking]);

  const send = useCallback(
    (message: PanelMessage) => {
      const port = portRef.current;
      if (message.type === 'ask') asking.current.add(message.requestId);
      if (port !== null) {
        try {
          port.postMessage(message);
          return;
        } catch {
          // The worker stopped before the port's disconnect arrived.
        }
      }
      if (message.type === 'ask') failAsking();
    },
    [failAsking],
  );
  usePageDiagnostics(send);

  const onAskStatus = useCallback((listener: AskStatusListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return { view, send, onAskStatus };
}
