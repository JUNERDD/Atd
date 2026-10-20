import { Type, type Static } from 'typebox';
import { VIEW_MESSAGE_MAX } from './views.js';

/**
 * The view protocol: JSON-RPC 2.0 over `postMessage` between the view runtime and its host frame.
 * Method names follow MCP Apps (spec 2026-01-26) where the meaning is the same; `atd/…` methods
 * cover what MCP Apps has no method for. The view posts to `window.parent` with target origin `*`
 * (its own origin is opaque); the host accepts only messages whose `source` is its frame's window.
 */
export const VIEW_PROTOCOL_VERSION = '2026-01-26';

export const ViewMethod = {
  /** View → host request; the result is `ViewInitializeResult`. */
  initialize: 'ui/initialize',
  /** View → host notification once the runtime applied the initialize result. */
  initialized: 'ui/notifications/initialized',
  /** View → host notification with the document's content height. */
  sizeChanged: 'ui/notifications/size-changed',
  /**
   * View → host request to send a message to the agent; result `{}`, or an error when refused. A
   * widget's is always refused: the user acts in the window.
   */
  message: 'ui/message',
  /** View → host request to open an http(s) link in the browser; refused for a widget too. */
  openLink: 'ui/open-link',
  /**
   * View → host notification saving the window's state for its next mount, in any renderer
   * window; a widget's is ignored.
   */
  state: 'atd/notifications/state',
  /** View → host notification reporting an uncaught error in the view's scripts. */
  error: 'atd/notifications/error',
  /** Host → view notification when the theme or locale changed. */
  hostContextChanged: 'ui/notifications/host-context-changed',
  /** Host → view notification carrying data from a later `update_ui`. */
  data: 'atd/notifications/data',
} as const;

/** JSON-RPC error codes a host answers with. */
export const ViewErrorCode = {
  /** The host refused the request (no recent user interaction, too frequent, view settled). */
  refused: -32000,
  methodNotFound: -32601,
  invalidParams: -32602,
} as const;

const JsonRpcId = Type.Union([Type.Integer(), Type.String({ maxLength: 64 })]);

/** Any message a view posts; the host validates `params` per method after this envelope. */
export const ViewInboundSchema = Type.Object(
  {
    jsonrpc: Type.Literal('2.0'),
    id: Type.Optional(JsonRpcId),
    method: Type.String({ maxLength: 64 }),
    params: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: true },
);
export type ViewInbound = Static<typeof ViewInboundSchema>;

export const ViewInitializeParamsSchema = Type.Object(
  { protocolVersion: Type.String({ maxLength: 32 }) },
  { additionalProperties: true },
);

export const ViewSizeChangedParamsSchema = Type.Object(
  {
    width: Type.Optional(Type.Number({ minimum: 0 })),
    height: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: true },
);

export const ViewMessageParamsSchema = Type.Object(
  {
    role: Type.Literal('user'),
    content: Type.Array(
      Type.Object(
        {
          type: Type.Literal('text'),
          text: Type.String({ minLength: 1, maxLength: VIEW_MESSAGE_MAX }),
        },
        { additionalProperties: true },
      ),
      { minItems: 1, maxItems: 1 },
    ),
  },
  { additionalProperties: true },
);
export type ViewMessageParams = Static<typeof ViewMessageParamsSchema>;

export const ViewOpenLinkParamsSchema = Type.Object(
  { url: Type.String({ minLength: 1, maxLength: 2048 }) },
  { additionalProperties: true },
);

/** The state value is size-checked against `VIEW_STATE_MAX_BYTES` separately. */
export const ViewStateParamsSchema = Type.Object(
  { state: Type.Unknown() },
  { additionalProperties: true },
);

export const ViewErrorParamsSchema = Type.Object(
  { message: Type.String({ maxLength: 2000 }) },
  { additionalProperties: true },
);

/** What the host shares with a view at initialize and in `hostContextChanged`. */
export const ViewHostContextSchema = Type.Object(
  {
    theme: Type.Union([Type.Literal('light'), Type.Literal('dark')]),
    /** BCP 47 language of the app UI, for example `en` or `zh-CN`. */
    locale: Type.String({ maxLength: 35 }),
    /** `inline` for a widget in the conversation, `fullscreen` for a window the view fills. */
    displayMode: Type.Union([Type.Literal('inline'), Type.Literal('fullscreen')]),
    platform: Type.Literal('desktop'),
  },
  { additionalProperties: false },
);
export type ViewHostContext = Static<typeof ViewHostContextSchema>;

/**
 * The host's `ui/initialize` result. `atd` carries what MCP Apps has no field for: the view's
 * current data and its revision (0 for `show_ui`'s own data, +1 per applied `update_ui`), and the
 * state the view's window last saved (null when none, and always for a widget).
 */
export const ViewInitializeResultSchema = Type.Object(
  {
    protocolVersion: Type.String({ maxLength: 32 }),
    hostInfo: Type.Object(
      { name: Type.String({ maxLength: 64 }), version: Type.String({ maxLength: 64 }) },
      { additionalProperties: false },
    ),
    hostCapabilities: Type.Object(
      { openLinks: Type.Object({}, { additionalProperties: false }) },
      { additionalProperties: false },
    ),
    hostContext: ViewHostContextSchema,
    atd: Type.Object(
      {
        data: Type.Unknown(),
        revision: Type.Integer({ minimum: 0 }),
        state: Type.Unknown(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ViewInitializeResult = Static<typeof ViewInitializeResultSchema>;

/** Host → view `atd/notifications/data` params. */
export const ViewDataParamsSchema = Type.Object(
  { data: Type.Unknown(), revision: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);
export type ViewDataParams = Static<typeof ViewDataParamsSchema>;
