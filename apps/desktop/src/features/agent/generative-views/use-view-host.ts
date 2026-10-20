import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  ViewErrorCode,
  ViewErrorParamsSchema,
  ViewInitializeParamsSchema,
  ViewMethod,
  ViewSizeChangedParamsSchema,
  ViewStateParamsSchema,
  type ViewHostContext,
  type ViewSurface,
  type ViewTheme,
} from '@atd/agent-contracts';
import type { InputRequest } from '../../../client/agent/permission-schema';
import { viewKey } from './view-call';
import type { ViewSnapshot } from './view-fold';
import {
  hostContext,
  initializeResult,
  isSavableState,
  paramsOf,
  parseInbound,
  rpcError,
  rpcNotification,
  rpcResult,
  widgetHeight,
  type RpcOutbound,
} from './view-protocol';
import { answerMessage, answerOpenLink, refuseInWidget, watchEngagement } from './view-requests';
import { readViewState, saveViewState } from './view-state-store';

/** How long a frame on screen may take to answer the handshake and report its first size. */
const HANDSHAKE_MS = 10_000;

/** What WebKit reports for an uncaught error in a sandboxed frame's script: no detail. */
const MUTED_SCRIPT_ERROR = 'Script error.';

export interface ViewHostInputs {
  /** Which of the view's documents the frame holds; fixed for the mount. */
  surface: ViewSurface;
  taskId: string;
  callId: string;
  theme: ViewTheme;
  /** The app's language, such as `en` or `zh-CN`. */
  locale: string;
  snapshot: ViewSnapshot;
  /** The pending input request on the view's call while the agent waits for the user. */
  request: InputRequest | undefined;
  /** The frame cannot show its view: it took too long, or another document replaced it. */
  onLost: () => void;
}

export interface ScriptError {
  /** The first reported message with detail; null while every report was muted. */
  message: string | null;
  count: number;
}

export interface ViewHost {
  /** The view answered the handshake and reported its size, so its frame can show. */
  ready: boolean;
  /** The uncaught errors the view reported, once it reported any. */
  scriptError: ScriptError | null;
}

/**
 * Calls `expire` once the frame spent `HANDSHAKE_MS` on screen. WebKit does not render a frame
 * out of view (in a turn the transcript skips, or scrolled away), so a view cannot report its size
 * there; only the time on screen counts. Returns the stop.
 */
function handshakeClock(frame: HTMLIFrameElement, expire: () => void): () => void {
  let remaining = HANDSHAKE_MS;
  let since = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pause = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    remaining -= performance.now() - since;
  };
  const observer = new IntersectionObserver((entries) => {
    if (!entries.at(-1)?.isIntersecting) pause();
    else if (timer === undefined) {
      since = performance.now();
      timer = setTimeout(expire, remaining);
    }
  });
  observer.observe(frame);
  return () => {
    observer.disconnect();
    pause();
  };
}

/**
 * The host side of one mounted view frame (`ViewMethod`), on either surface: it accepts messages
 * only from the frame's own window, answers the handshake with the app's context and the view's
 * data, collects its script errors, and once the handshake is answered pushes later data
 * revisions and theme or language changes. The frame shows once the view is initialized and has
 * reported its size; `onLost` reports a view that is not after `HANDSHAKE_MS` on screen. A mount
 * serves one document: the shell lets a view navigate its frame to another view's document, so a
 * second `ui/initialize` ends the session (nothing more is answered, pushed or accepted from the
 * frame) and reports the view lost until a new mount.
 *
 * The surfaces differ in what the view may do. A widget shows inline: its frame takes the height
 * it reports, clamped to the widget's range, it saves no state, and its requests to send a
 * message or open a link are refused. A window fills its window, so its size reports only count
 * toward showing; it starts from the state it last saved (`view-state-store.ts`) and keeps what
 * it saves, and its requests are answered as `view-requests.ts` decides.
 */
export function useViewHost(
  frameRef: RefObject<HTMLIFrameElement | null>,
  inputs: ViewHostInputs,
): ViewHost {
  const [ready, setReady] = useState(false);
  const [scriptError, setScriptError] = useState<ScriptError | null>(null);
  // The inputs as of the latest render, for messages that arrive between renders.
  const latest = useRef(inputs);
  useLayoutEffect(() => {
    latest.current = inputs;
  });
  // What the view was told, from the handshake's answer on: its context and data revision.
  const told = useRef<{ context: ViewHostContext; revision: number } | null>(null);

  // Attached in the commit that inserts the frame, so no message of its document can come first.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const { surface } = latest.current;
    const key = viewKey(latest.current.taskId, latest.current.callId);
    const engagement = surface === 'window' ? watchEngagement(frame) : null;
    let handshakes = 0;
    let dropped = false;
    const post = (message: RpcOutbound) => {
      if (!dropped) frame.contentWindow?.postMessage(message, '*');
    };
    const lost = () => latest.current.onLost();
    const stopClock = handshakeClock(frame, lost);
    let initialized = false;
    let sized = false;
    const settle = () => {
      if (!initialized || !sized) return;
      stopClock();
      setReady(true);
    };
    const onMessage = (event: MessageEvent) => {
      if (dropped || event.source === null || event.source !== frame.contentWindow) return;
      const message = parseInbound(event.data);
      if (!message) return;
      const { id, method, params } = message;
      switch (method) {
        case ViewMethod.initialize: {
          handshakes += 1;
          if (handshakes > 1) {
            dropped = true;
            told.current = null;
            stopClock();
            lost();
            return;
          }
          if (id === undefined) return;
          if (!paramsOf(ViewInitializeParamsSchema, params)) {
            post(rpcError(id, ViewErrorCode.invalidParams, 'Expected a protocolVersion.'));
            return;
          }
          const { theme, locale, snapshot } = latest.current;
          const context = hostContext(theme, locale, surface);
          told.current = { context, revision: snapshot.revision };
          const state = surface === 'window' ? readViewState(key) : null;
          post(rpcResult(id, initializeResult(context, snapshot, state)));
          return;
        }
        case ViewMethod.initialized:
          initialized = true;
          settle();
          return;
        case ViewMethod.sizeChanged: {
          const size = paramsOf(ViewSizeChangedParamsSchema, params);
          if (!size) return;
          // Set on the element rather than rendered: a widget that animates its height re-renders
          // nothing around it.
          if (surface === 'widget') frame.style.height = `${widgetHeight(size.height)}px`;
          sized = true;
          settle();
          return;
        }
        case ViewMethod.state: {
          const saved = paramsOf(ViewStateParamsSchema, params);
          if (surface === 'window' && saved && isSavableState(saved.state))
            saveViewState(key, saved.state);
          return;
        }
        case ViewMethod.error: {
          const reported = paramsOf(ViewErrorParamsSchema, params);
          if (!reported) return;
          const text = reported.message.trim();
          const detail = text && text !== MUTED_SCRIPT_ERROR ? text : null;
          setScriptError((current) => ({
            message: current?.message ?? detail,
            count: (current?.count ?? 0) + 1,
          }));
          return;
        }
        case ViewMethod.message:
        case ViewMethod.openLink: {
          if (id === undefined) return;
          // Only a window watches engagement: a widget acts on nothing.
          if (!engagement) {
            post(refuseInWidget(id));
            return;
          }
          const { taskId, request } = latest.current;
          const scope = { key, taskId, request, engaged: engagement.engaged() };
          const answer = method === ViewMethod.message ? answerMessage : answerOpenLink;
          void answer(id, params, scope).then(post);
          return;
        }
        default:
          if (id !== undefined)
            post(rpcError(id, ViewErrorCode.methodNotFound, `Unknown method: ${method}`));
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      stopClock();
      engagement?.stop();
    };
  }, [frameRef]);

  const { snapshot, theme, locale, surface } = inputs;
  useEffect(() => {
    const said = told.current;
    if (!said || snapshot.revision <= said.revision) return;
    told.current = { ...said, revision: snapshot.revision };
    const params = { data: snapshot.data, revision: snapshot.revision };
    frameRef.current?.contentWindow?.postMessage(rpcNotification(ViewMethod.data, params), '*');
  }, [frameRef, snapshot]);
  useEffect(() => {
    const said = told.current;
    if (!said || (said.context.theme === theme && said.context.locale === locale)) return;
    const context = hostContext(theme, locale, surface);
    told.current = { ...said, context };
    const message = rpcNotification(ViewMethod.hostContextChanged, context);
    frameRef.current?.contentWindow?.postMessage(message, '*');
  }, [frameRef, theme, locale, surface]);

  return { ready, scriptError };
}
