import { useCallback, useEffect, useRef, useState } from 'react';
import type { OwnInput } from '../channel/payloads.ts';
import type { PanelMessage } from '../messages/panel.ts';
import type { AskFailure } from '../messages/views.ts';
import type { ActivePage, ComposeBlock } from './model.ts';
import type { PanelChannel } from './use-panel-channel.ts';

export interface ComposerDeps {
  page: ActivePage;
  block: ComposeBlock | null;
  /** The conversation the request replies to (its task); null sends a new task. */
  replyTo: string | null;
  send: (message: PanelMessage) => void;
  onAskStatus: PanelChannel['onAskStatus'];
  takeOwnInput: () => OwnInput | undefined;
  /** A request failed: the field takes focus again, with the draft. */
  failed: () => void;
}

export interface ComposerState {
  text: string;
  setText: (text: string) => void;
  /** The person's choice for the page chip; only a website's page can go along. */
  includePage: boolean;
  setIncludePage: (include: boolean) => void;
  sending: boolean;
  failure: AskFailure | null;
  canSend: boolean;
  submit: () => void;
}

/**
 * The panel's request, from draft to Atd's answer. The draft stays across tab switches and goes
 * from the tab the window shows when it is sent, with that tab's page while the person keeps the
 * page chip, as a reply to `replyTo` while the person keeps the reply chip. Atd takes one request
 * per browser at a time; while one is on its way nothing more is sent. Taken, the draft clears for
 * the next request (its run then shows among the runs; a reply's, in its conversation, which the
 * composer goes on replying to); refused, the draft stays with the reason.
 */
export function useComposer(deps: ComposerDeps): ComposerState {
  const { page, block, replyTo, send, onAskStatus, takeOwnInput, failed } = deps;
  const [text, setText] = useState('');
  const [includePage, setIncludePage] = useState(true);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<AskFailure | null>(null);
  const pending = useRef<string | null>(null);

  useEffect(
    () =>
      onAskStatus((status) => {
        if (status.requestId !== pending.current) return;
        pending.current = null;
        setSending(false);
        if (status.state === 'accepted') {
          setText('');
          setIncludePage(true);
          return;
        }
        // A code this version does not know reads as the generic failure.
        setFailure(status.reason ?? 'failed');
        failed();
      }),
    [onAskStatus, failed],
  );

  const request = text.trim();
  const tabId = page.kind === 'loading' ? null : page.tabId;
  const canSend = request.length > 0 && !sending && block === null && tabId !== null;

  const submit = useCallback(() => {
    if (!canSend || tabId === null) return;
    const requestId = crypto.randomUUID();
    pending.current = requestId;
    setSending(true);
    setFailure(null);
    const ownInput = takeOwnInput();
    send({
      type: 'ask',
      requestId,
      tabId,
      text: request,
      includePage: page.kind === 'web' && includePage,
      ...(replyTo === null ? {} : { taskId: replyTo }),
      ...(ownInput === undefined ? {} : { ownInput }),
    });
  }, [canSend, tabId, takeOwnInput, send, request, page.kind, includePage, replyTo]);

  return {
    text,
    setText,
    includePage,
    setIncludePage,
    sending,
    failure,
    canSend,
    submit,
  };
}
