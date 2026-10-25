import { Type, type Static } from 'typebox';

/**
 * Generative views: interactive HTML the agent shows with `show_ui` (`SHOW_UI_TOOL`) and feeds new
 * data with `update_ui` (`UPDATE_UI_TOOL`). Like a user app, a view has two surfaces
 * (`ViewSurface`): its widget, a glance the conversation shows inline in the agent's turn, and its
 * window, the whole interactive view, which opens in a window of its own when the user clicks the
 * widget. Unlike an app's desktop widgets, the widget is HTML too, framed by the transcript.
 *
 * Ownership. The service validates both calls and assembles each surface's document from the
 * session's `show_ui` call: the apple-design web kit it vendors, the view runtime that defines
 * `window.atd`, and the agent's HTML for that surface. The shell serves those documents at the
 * view origin (`ai-view://view/…`) with its own network-less CSP, only inside renderer pages, and
 * opens a view's window: a native window whose renderer page (`#view`) frames the window document.
 * Each renderer page hosts a document in a sandboxed iframe (`allow-scripts allow-forms`, never
 * `allow-same-origin`), speaks the protocol below over `postMessage`, and turns the window's
 * messages into the answer of a waiting call or a user message; a widget only shows. The session
 * is the source of truth: a view's documents, its initial data and its later updates all come from
 * the transcript's `show_ui` and `update_ui` calls.
 */

/** Longest view title: the widget's heading, the window's title, and their accessible name. */
export const VIEW_TITLE_MAX = 120;
/** Longest `html` (the window) a `show_ui` call may carry, in UTF-16 code units. */
export const VIEW_HTML_MAX = 100_000;
/** Longest `widget` a `show_ui` call may carry, in UTF-16 code units. */
export const VIEW_WIDGET_HTML_MAX = 20_000;
/** Largest `data` value of `show_ui` or `update_ui`: UTF-8 bytes of its JSON text. */
export const VIEW_DATA_MAX_BYTES = 65_536;
/** Largest state a view saves through `atd.setState`: UTF-8 bytes of its JSON text. */
export const VIEW_STATE_MAX_BYTES = 65_536;
/** Longest message a view sends, in characters; equal to the cap of a confirm `answer`. */
export const VIEW_MESSAGE_MAX = 10_000;
/** Most kit blocks one `show_ui` call may name. */
export const VIEW_BLOCKS_MAX = 32;
/**
 * The widget frame's height is the widget's reported content height clamped to this range (px);
 * a widget taller than the maximum is cut off at it.
 */
export const VIEW_HEIGHT_MIN = 32;
export const VIEW_WIDGET_HEIGHT_MAX = 240;
/**
 * A view window's size in points, title bar included: the bounds of `show_ui` `window`, and the
 * size a view that names none opens at. The shell also keeps a window inside the work area.
 */
export const VIEW_WINDOW_MIN_WIDTH = 320;
export const VIEW_WINDOW_MAX_WIDTH = 1600;
export const VIEW_WINDOW_MIN_HEIGHT = 240;
export const VIEW_WINDOW_MAX_HEIGHT = 1200;
export const VIEW_WINDOW_DEFAULT_WIDTH = 560;
export const VIEW_WINDOW_DEFAULT_HEIGHT = 640;
/** The window's title bar, above the view's document: the shell's unified 52pt bar. */
export const VIEW_WINDOW_TITLE_BAR_HEIGHT = 52;

/**
 * How readily the agent shows views (`UserSettings.viewInitiative`), in the order Settings lists
 * them. Each run freezes the level as it starts, and the agent reads it in its instructions:
 * - `proactive`, the default: it watches for the moments a view would help and shows one unasked;
 * - `balanced`: it shows one when a view clearly serves the user better than text;
 * - `onRequest`: it shows one only when the user asks for one.
 * At every level, answers that read well as text stay text, and a run nobody watches (an
 * automation) shows a view only to present results for later.
 */
export const VIEW_INITIATIVES = ['proactive', 'balanced', 'onRequest'] as const;
export type ViewInitiative = (typeof VIEW_INITIATIVES)[number];
export const ViewInitiativeSchema = Type.Union([
  Type.Literal('proactive'),
  Type.Literal('balanced'),
  Type.Literal('onRequest'),
]);
export const DEFAULT_VIEW_INITIATIVE: ViewInitiative = 'proactive';

/** A kit block name as `build_kit.py --list` prints it; the service checks it against its kit. */
const KitBlockName = Type.String({ minLength: 1, maxLength: 32, pattern: '^[a-z][a-z0-9-]*$' });

/** `show_ui` arguments. The descriptions are the model's parameter documentation. */
export const ShowUiParamsSchema = Type.Object(
  {
    title: Type.String({
      minLength: 1,
      maxLength: VIEW_TITLE_MAX,
      description:
        "Short name of the view: the widget's heading and the window's title, also read by assistive technology.",
    }),
    widget: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: VIEW_WIDGET_HTML_MAX,
        description: `The widget shown in the conversation: a compact glance at the view, at most ${VIEW_WIDGET_HEIGHT_MAX} px tall, that the user clicks to open the window. It does not take input. Same markup rules as html. Omit for a plain card with the title.`,
      }),
    ),
    html: Type.String({
      minLength: 1,
      maxLength: VIEW_HTML_MAX,
      description:
        "The view's window, where the user works with it: markup using the apple-design kit classes, plus optional inline <style> and <script>. No <html>, <head> or <body> wrapper, and nothing loaded from the network.",
    }),
    window: Type.Optional(
      Type.Object(
        {
          width: Type.Optional(
            Type.Integer({ minimum: VIEW_WINDOW_MIN_WIDTH, maximum: VIEW_WINDOW_MAX_WIDTH }),
          ),
          height: Type.Optional(
            Type.Integer({ minimum: VIEW_WINDOW_MIN_HEIGHT, maximum: VIEW_WINDOW_MAX_HEIGHT }),
          ),
        },
        {
          additionalProperties: false,
          description: `The window's preferred size in points, including its ${VIEW_WINDOW_TITLE_BAR_HEIGHT} pt title bar. Default ${VIEW_WINDOW_DEFAULT_WIDTH}x${VIEW_WINDOW_DEFAULT_HEIGHT}.`,
        },
      ),
    ),
    blocks: Type.Optional(
      Type.Array(KitBlockName, {
        maxItems: VIEW_BLOCKS_MAX,
        description:
          'Kit blocks the widget and the window use, such as button, list, segmented or switch; their requirements are added for you. Omit for the default set.',
      }),
    ),
    data: Type.Optional(
      Type.Unknown({
        description:
          'JSON data the widget and the window read as atd.data; replace it later with update_ui.',
      }),
    ),
    wait: Type.Optional(
      Type.Boolean({
        description:
          "true: wait until the user responds through the view's window and return their response. Default false: return at once; the user's later messages from the window arrive as user messages.",
      }),
    ),
  },
  { additionalProperties: false },
);
export type ShowUiParams = Static<typeof ShowUiParamsSchema>;

/** `update_ui` arguments: new data for a view this task showed. */
export const UpdateUiParamsSchema = Type.Object(
  {
    id: Type.String({
      minLength: 1,
      maxLength: 256,
      description: 'The view id show_ui returned.',
    }),
    data: Type.Unknown({
      description:
        'The JSON data that replaces atd.data; the widget and an open window receive it through atd.onData.',
    }),
  },
  { additionalProperties: false },
);
export type UpdateUiParams = Static<typeof UpdateUiParamsSchema>;

/**
 * What a waiting `show_ui` call returns: the prefix before the user's response, and the whole
 * text when the user dismissed the view. The renderer reads the response back from the result.
 */
export const VIEW_RESPONSE_PREFIX = 'The user responded through the view: ';
export const VIEW_DISMISSED_TEXT = 'The user dismissed the view without responding.';

/** UTF-8 bytes of a value's JSON text, the measure of `VIEW_DATA_MAX_BYTES` and the state cap. */
export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength;
}

/** Scheme and host of the view origin; the shell serves nothing else there. */
export const VIEW_SCHEME = 'ai-view';
export const VIEW_HOST = 'view';

export type ViewTheme = 'light' | 'dark';

/**
 * Where a view's document shows: `widget`, its glance inline in the conversation, which takes no
 * input and opens the window when clicked; or `window`, the whole view in its own window, which
 * sends the user's messages. The assembled document names its surface on its root element
 * (`data-surface`), and the runtime exposes it as `atd.surface`.
 */
export type ViewSurface = 'widget' | 'window';

/** The last path segment of a widget document's URL and route. */
const WIDGET_SEGMENT = 'widget';

/**
 * A view document's URL: `ai-view://view/<taskId>/<callId>?theme=…&lang=…` for the window and
 * `ai-view://view/<taskId>/<callId>/widget?…` for the widget, each id one percent-encoded path
 * segment. The query only seeds the document's first paint (the runtime applies `data-theme` and
 * `lang` before the body renders); later changes arrive through the protocol, so a host keeps the
 * URL it mounted with instead of reloading the frame.
 */
export function viewDocumentUrl(
  taskId: string,
  callId: string,
  context: { theme: ViewTheme; lang: string; surface: ViewSurface },
): string {
  const query = new URLSearchParams({ theme: context.theme, lang: context.lang });
  const path = `${encodeURIComponent(taskId)}/${encodeURIComponent(callId)}`;
  const surface = context.surface === 'widget' ? `/${WIDGET_SEGMENT}` : '';
  return `${VIEW_SCHEME}://${VIEW_HOST}/${path}${surface}?${query.toString()}`;
}

/**
 * The service's shell-only routes that return a view's assembled window and widget documents as
 * `text/html; charset=utf-8`: 404 when the task's session has no such `show_ui` call, or, for the
 * widget, when the call has no `widget`. The shell calls them with the service token and adds the
 * view CSP; the renderer never reaches them.
 */
export const VIEW_DOCUMENT_ROUTE = '/v1/tasks/:taskId/views/:callId';
export const VIEW_WIDGET_ROUTE = `${VIEW_DOCUMENT_ROUTE}/${WIDGET_SEGMENT}`;

export function viewDocumentPath(taskId: string, callId: string, surface: ViewSurface): string {
  const path = `/v1/tasks/${encodeURIComponent(taskId)}/views/${encodeURIComponent(callId)}`;
  return surface === 'widget' ? `${path}/${WIDGET_SEGMENT}` : path;
}
