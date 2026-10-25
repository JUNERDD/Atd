import type { ShowUiParams, ViewSurface } from '@atd/agent-contracts';
import {
  ALWAYS_BLOCKS,
  DEFAULT_BLOCKS,
  resolveBlocks,
  type KitBlock,
  type OrderedBlock,
  type ViewKit,
} from './kit.js';

/**
 * A view's document: the kit CSS for its blocks, the view runtime, the agent's markup verbatim
 * (the window's `html`, or the `widget`), then the kit scripts and their start. Both surfaces get
 * the same kit, runtime and blocks; the root element's `data-surface` tells the runtime which one
 * it is in. The shell serves it at the view origin under its own CSP, so nothing here sets a
 * policy. The kit parts mirror `.agents/skills/apple-design/scripts/build_kit.py` (`resolve`, then
 * `assemble` layered and `build_js`), without their banner comments.
 */

/** The cascade layer each kit layer's blocks are wrapped in (build_kit.py `LAYERS`). */
const LAYER_NAMES: Record<KitBlock['layer'], string> = {
  base: 'apple.base',
  components: 'apple.components',
};

/**
 * Lets the view's content decide the frame's height, over the host's own surface, and keeps the
 * `hidden` attribute effective on kit components, whose own `display` would otherwise override it.
 * A widget never scrolls: the host clips it to the widget height.
 */
const FRAME_RESET: Record<ViewSurface, string> = {
  window: 'html,body{margin:0;background:transparent}[hidden]{display:none!important}',
  widget:
    'html,body{margin:0;background:transparent;overflow:hidden}[hidden]{display:none!important}',
};

/** Starts the kit once the body is parsed: press states, glass glint, then each block's script. */
const KIT_START =
  'AppleFeedback.initPressStates();AppleFeedback.initGlassGlint();Object.values(globalThis.AppleBlocks??{}).forEach(function(b){b.init()});';

/**
 * The document of one surface of a `show_ui` call whose arguments passed `viewProblems`
 * (content.ts). A widget document needs the call's `widget`; the routes answer 404 before asking
 * for one a call does not have.
 */
export function viewDocument(
  params: Pick<ShowUiParams, 'title' | 'widget' | 'html' | 'blocks'>,
  kit: ViewKit,
  surface: ViewSurface,
): string {
  const markup = surface === 'widget' ? params.widget : params.html;
  if (markup === undefined) throw new Error('This view has no widget.');
  const order = resolveBlocks(
    new Set([...ALWAYS_BLOCKS, ...(params.blocks ?? DEFAULT_BLOCKS)]),
    kit.blocks,
  );
  return [
    '<!doctype html>',
    `<html lang="en" data-platform="macos" data-surface="${surface}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<title>${escapeHtml(params.title)}</title>`,
    `<style data-kit>${inlineStyle(kitCss(order, kit))}</style>`,
    `<style>${FRAME_RESET[surface]}</style>`,
    `<script>${inlineScript(kit.runtime)}</script>`,
    '</head>',
    '<body>',
    markup,
    `<script>${inlineScript(kitJs(order, kit))}</script>`,
    `<script>${KIT_START}</script>`,
    '</body>',
    '</html>',
  ].join('\n');
}

/**
 * build_kit.py `assemble`, layered: the layer statement, the unlayered tokens, then each run of
 * consecutive same-layer blocks wrapped in its `@layer`.
 */
function kitCss(order: readonly OrderedBlock[], kit: ViewKit): string {
  const out = [kit.layers.trim(), kit.tokens.trim()];
  let layer: KitBlock['layer'] | null = null;
  let run: string[] = [];
  const flush = () => {
    if (layer && run.length) out.push(`@layer ${LAYER_NAMES[layer]} {\n${run.join('\n\n')}\n}`);
  };
  for (const { block } of order) {
    if (block.layer !== layer) {
      flush();
      layer = block.layer;
      run = [];
    }
    run.push(block.css.trim());
  }
  flush();
  return out.join('\n\n');
}

/**
 * build_kit.py `build_js`: the core classic script, then the script of each ordered block that has
 * one. Each part ends in `;`, so no part can continue the expression of the part before it.
 */
function kitJs(order: readonly OrderedBlock[], kit: ViewKit): string {
  const parts = [kit.coreJs, ...order.map(({ block }) => block.js)]
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((part) => (part.endsWith(';') ? part : `${part};`)).join('\n');
}

/** Text as an inline style may hold it: `</style` would end the element early. */
function inlineStyle(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1');
}

/**
 * Text as an inline script may hold it: `</script` would end the element early. `<\/` reads as
 * `</` in JavaScript strings, templates and regular expressions alike.
 */
function inlineScript(js: string): string {
  return js.replace(/<\/(script)/gi, '<\\/$1');
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
