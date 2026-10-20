import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';
import {
  jsonByteLength,
  VIEW_HEIGHT_MIN,
  VIEW_PROTOCOL_VERSION,
  VIEW_STATE_MAX_BYTES,
  VIEW_WIDGET_HEIGHT_MAX,
  ViewInboundSchema,
  type ViewHostContext,
  type ViewInbound,
  type ViewInitializeResult,
  type ViewSurface,
  type ViewTheme,
} from '@atd/agent-contracts';
import type { ViewSnapshot } from './view-fold';

/**
 * The host's side of the view protocol (`ViewMethod` in `@atd/agent-contracts`): JSON-RPC 2.0
 * envelopes the frame posts and the host answers, checked with typebox's interpreted `Value` API
 * (its compiled validators build their check with `new Function`, which the page's CSP forbids).
 */

/** The id of a view's request, which its answer repeats. */
export type RpcId = NonNullable<ViewInbound['id']>;

/** What the host posts to a frame: an answer to one of its requests, or a notification. */
export type RpcOutbound =
  | { jsonrpc: '2.0'; id: RpcId; result: object }
  | { jsonrpc: '2.0'; id: RpcId; error: { code: number; message: string } }
  | { jsonrpc: '2.0'; method: string; params: object };

/**
 * Names this host in the initialize result. `version` is this host's implementation of the
 * protocol, not the app's: it changes when what the host answers changes.
 */
const HOST_INFO = { name: 'Atd', version: '1' };

/** A message a frame posted, when it is a JSON-RPC 2.0 request or notification. */
export function parseInbound(data: unknown): ViewInbound | null {
  return Value.Check(ViewInboundSchema, data) ? data : null;
}

/** `params` when they fit `schema`; null otherwise. */
export function paramsOf<T extends TSchema>(schema: T, params: unknown): Static<T> | null {
  return Value.Check(schema, params) ? params : null;
}

export function rpcResult(id: RpcId, result: object): RpcOutbound {
  return { jsonrpc: '2.0', id, result };
}

export function rpcError(id: RpcId, code: number, message: string): RpcOutbound {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export function rpcNotification(method: string, params: object): RpcOutbound {
  return { jsonrpc: '2.0', method, params };
}

/**
 * What the host tells a view about the app: its theme and language, and how it shows: inline as
 * the widget in the conversation, or filling its window.
 */
export function hostContext(
  theme: ViewTheme,
  locale: string,
  surface: ViewSurface,
): ViewHostContext {
  const displayMode = surface === 'widget' ? 'inline' : 'fullscreen';
  return { theme, locale, displayMode, platform: 'desktop' };
}

/**
 * The `ui/initialize` answer: the host, the app's context, and the view's data and saved state
 * (always null for a widget, which saves none).
 */
export function initializeResult(
  context: ViewHostContext,
  snapshot: ViewSnapshot,
  state: unknown,
): ViewInitializeResult {
  return {
    protocolVersion: VIEW_PROTOCOL_VERSION,
    hostInfo: HOST_INFO,
    hostCapabilities: { openLinks: {} },
    hostContext: context,
    atd: { data: snapshot.data, revision: snapshot.revision, state },
  };
}

/**
 * The widget frame's height for a reported content height: whole pixels within the widget's
 * range, so a taller widget is cut off at `VIEW_WIDGET_HEIGHT_MAX`. A window's frame fills its
 * window instead.
 */
export function widgetHeight(reported: number): number {
  return Math.min(Math.max(Math.ceil(reported), VIEW_HEIGHT_MIN), VIEW_WIDGET_HEIGHT_MAX);
}

/**
 * Whether a view's state may be saved: JSON within `VIEW_STATE_MAX_BYTES`. A structured clone can
 * carry what JSON cannot (a cycle, a BigInt), which is refused like an oversized state.
 */
export function isSavableState(state: unknown): boolean {
  try {
    return jsonByteLength(state) <= VIEW_STATE_MAX_BYTES;
  } catch {
    return false;
  }
}

/** The normalized URL of a link a view asks to open; null for anything but http(s). */
export function webLink(url: string): string | null {
  const parsed = URL.parse(url);
  return parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    ? parsed.href
    : null;
}
