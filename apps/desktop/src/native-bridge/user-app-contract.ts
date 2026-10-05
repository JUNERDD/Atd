/**
 * The bridge between a user app's page (`ai-userapp://<appId>/`) and the macOS shell: a contract
 * of its own, separate from the renderer's (`contract.ts`), with its own generated Swift types and
 * its own dispatcher; it never reaches `ShellBridge`. Like the renderer contract, export scripts
 * load it with Node's type stripping, so it imports nothing but TypeBox and its sibling contract
 * files (by their `.ts` names) and uses only erasable TypeScript syntax.
 *
 * Transport: the shell registers `USER_APP_MESSAGE_HANDLER` as a `WKScriptMessageHandlerWithReply`,
 * so the page awaits `window.webkit.messageHandlers.atdApp.postMessage(message)` with a
 * `UserAppMessage`. WebKit pairs each reply with its message, so messages carry no id: Swift
 * resolves a call with its `result` value and a post with `null`, or rejects with an error
 * message. The shell accepts messages only from the main frame of `ai-userapp://<appId>` (port 0)
 * whose host is the app of the window that sent them, and validates every payload.
 */
import { Type, type Static, type TSchema } from 'typebox';
import { Empty, MAX_NATIVE_TEXT_LENGTH, Text } from './primitives.ts';

/** `WKScriptMessageHandlerWithReply` name the app page posts to. */
export const USER_APP_MESSAGE_HANDLER = 'atdApp';
/** URL scheme of app pages; the host is the app id. */
export const USER_APP_SCHEME = 'ai-userapp';

/** Mirrors agent-contracts `APP_ID_PATTERN` (this file cannot import the contracts package). */
export const USER_APP_ID_PATTERN = '^app-[a-z0-9]{10}$';
export const UserAppIdSchema = Type.String({ pattern: USER_APP_ID_PATTERN });

/** Largest file `files.pick` returns or `files.save` writes, in bytes. */
export const MAX_USER_APP_FILE_BYTES = 8 * 1024 * 1024;
/** `MAX_USER_APP_FILE_BYTES` as padded base64. */
const MAX_FILE_BASE64_LENGTH = Math.ceil(MAX_USER_APP_FILE_BYTES / 3) * 4;
const Base64 = Type.String({
  maxLength: MAX_FILE_BASE64_LENGTH,
  pattern: '^[A-Za-z0-9+/]*={0,2}$',
});

/** A picked file: its name (no path) and its bytes, never a URL or a Blob. */
export const UserAppFileSchema = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 255 }), bytesBase64: Base64 },
  { additionalProperties: false },
);

/** A rectangle in CSS pixels from the web view's top-left corner. */
const RectSchema = Type.Object(
  { x: Type.Number(), y: Type.Number(), width: Type.Number(), height: Type.Number() },
  { additionalProperties: false },
);

/** Posts: one-way messages the page sends; the reply is `null`. */
export const UserAppPosts = {
  /** The page loaded; the shell shows the window once its first page is ready. */
  'app.ready': Empty,
  /**
   * An error the page's injected capture saw: an uncaught `error`, an `unhandledrejection`, or a
   * `console.error`. The shell stamps it with the loaded version and forwards it as a frontend
   * diagnostic (`POST /v1/apps/:appId/diagnostics`).
   */
  'app.error': Type.Object(
    {
      kind: Type.Union([
        Type.Literal('error'),
        Type.Literal('unhandledrejection'),
        Type.Literal('console'),
      ]),
      message: Text(4000),
      stack: Type.Optional(Text(16000)),
    },
    { additionalProperties: false },
  ),
  /**
   * The window drag regions: where a press moves the window instead of reaching the page, as the
   * renderer's own `window.dragRegions` (WKWebView has no CSS drag regions). The shell's injected
   * script sends them for a glass window: the title bar strip at the top of the page, interactive
   * elements and overlays cut out, after every change that can move them, and `[]` when the page
   * goes away.
   */
  'window.dragRegions': Type.Object(
    { rects: Type.Array(RectSchema, { maxItems: 64 }) },
    { additionalProperties: false },
  ),
} satisfies Record<string, TSchema>;

/** Calls: requests the shell answers with `result`. */
export const UserAppCalls = {
  'clipboard.write': {
    params: Type.Object({ text: Text(MAX_NATIVE_TEXT_LENGTH) }, { additionalProperties: false }),
    result: Empty,
  },
  /**
   * Opens an http(s) URL in the default browser after the user confirms it in the shell. Resolves
   * once the user answered, whichever way.
   */
  'link.open': {
    params: Type.Object(
      { url: Type.String({ minLength: 1, maxLength: 2048, pattern: '^https?://' }) },
      { additionalProperties: false },
    ),
    result: Empty,
  },
  /**
   * Open panel. `types` narrows the choice to filename extensions without the dot (`csv`) or
   * Uniform Type Identifiers (`public.image`); `multiple` allows several files. `files` is empty
   * when the user cancelled; a file over `MAX_USER_APP_FILE_BYTES` rejects the call.
   */
  'files.pick': {
    params: Type.Object(
      {
        types: Type.Optional(
          Type.Array(Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9.+-]+$' }), {
            maxItems: 32,
          }),
        ),
        multiple: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
    result: Type.Object(
      { files: Type.Array(UserAppFileSchema, { maxItems: 10 }) },
      { additionalProperties: false },
    ),
  },
  /** Save panel offering the bytes under `suggestedName`; `saved` is false when cancelled. */
  'files.save': {
    params: Type.Object(
      { suggestedName: Type.String({ minLength: 1, maxLength: 255 }), bytesBase64: Base64 },
      { additionalProperties: false },
    ),
    result: Type.Object({ saved: Type.Boolean() }, { additionalProperties: false }),
  },
} satisfies Record<string, { params: TSchema; result: TSchema }>;

/** Everything the app page posts to `atdApp`. */
export const UserAppMessageSchema = Type.Union([
  ...Object.entries(UserAppCalls).map(([method, { params }]) =>
    Type.Object(
      { type: Type.Literal('call'), method: Type.Literal(method), params },
      { additionalProperties: false },
    ),
  ),
  ...Object.entries(UserAppPosts).map(([method, params]) =>
    Type.Object(
      { type: Type.Literal('post'), method: Type.Literal(method), params },
      { additionalProperties: false },
    ),
  ),
]);

export type UserAppCallName = keyof typeof UserAppCalls;
export type UserAppPostName = keyof typeof UserAppPosts;
export type UserAppCallParams<M extends UserAppCallName> = Static<
  (typeof UserAppCalls)[M]['params']
>;
export type UserAppCallResult<M extends UserAppCallName> = Static<
  (typeof UserAppCalls)[M]['result']
>;
export type UserAppPostParams<P extends UserAppPostName> = Static<(typeof UserAppPosts)[P]>;
