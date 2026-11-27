import baseCss from './base.css?inline';

/**
 * The extension's in-page layers. Each is a custom-element-named host on the root element with a
 * closed shadow root, so page scripts cannot reach inside and page styles cannot style it. The
 * host's own box is pinned with `!important` inline styles (which no page rule outranks) over
 * `all: initial`. Styles come from constructable stylesheets (`adoptedStyleSheets`), which a
 * page's CSP does not restrict the way it restricts injected `<style>` elements; each is parsed
 * the first time a layer that uses it mounts, so a page where Atd shows nothing parses none.
 *
 * A layer is in the page only while its surface shows: `mount` builds a fresh host around the
 * layer's root and `unmount` takes it out again, so an unpaired or idle tab carries nothing of
 * Atd's in its DOM. While mounted, the host is kept attached and its attributes are kept as Atd
 * set them (a page that hides, inerts or restyles it is undone at once).
 *
 * Every layer covers the viewport and passes pointer events through; the surfaces inside opt back
 * in. The HUD's host stays free of filter, opacity, blending and masks, which would make it the
 * backdrop root of its glass and hide the page and the light behind it from the blur.
 */

export type LayerTag = 'atd-glow' | 'atd-pointer' | 'atd-inspector' | 'atd-hud';

const TAGS: readonly LayerTag[] = ['atd-glow', 'atd-pointer', 'atd-inspector', 'atd-hud'];

/**
 * Stacking among the layers, all above the page's own content. The HUD is on top: its approval
 * buttons act only while nothing covers its card (`hud/guard.ts`), and a full-viewport layer
 * above it would count as covering it, even one of Atd's own. The inspector's highlight
 * (`inspector/`) marks the page's elements, under the HUD it is picked from.
 */
const Z_INDEX: Record<LayerTag, number> = {
  'atd-glow': 2147483644,
  'atd-pointer': 2147483645,
  'atd-inspector': 2147483646,
  'atd-hud': 2147483647,
};

/** The host's own box; nothing else on it survives (`Layer.restore`). */
const HOST_STYLE: readonly (readonly [string, string])[] = [
  ['all', 'initial'],
  ['position', 'fixed'],
  ['inset', '0'],
  ['pointer-events', 'none'],
  ['display', 'block'],
  ['visibility', 'visible'],
];

/** The sheet every layer shares, parsed when the first one mounts. */
let baseSheet: CSSStyleSheet | null = null;

function sheet(css: string): CSSStyleSheet {
  const result = new CSSStyleSheet();
  result.replaceSync(css);
  return result;
}

/** The layers in the page now. */
const mounted = new Set<Layer>();
let language = '';
let ended = false;
let keeper: MutationObserver | null = null;
let keptRoot: Element | null = null;

export class Layer {
  /** The surface root inside the shadow root; tokens and the theme live here. */
  readonly root: HTMLDivElement;
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private watcher: MutationObserver | null = null;
  /** The serialized inline style Atd last wrote, to tell a page's change from its own. */
  private written = '';
  /** Declarations beyond the host's box, such as the light's blend on dark pages. */
  private readonly extra = new Map<string, string>();
  /** The base sheet and the layer's own, from the first `mount` on. */
  private sheets: CSSStyleSheet[] | null = null;

  /** `css` (text imported with `?inline`) is added after the shared base sheet. */
  constructor(
    readonly tag: LayerTag,
    private readonly css: readonly string[],
  ) {
    this.root = document.createElement('div');
    this.root.className = 'root';
  }

  /** The host while the layer is in the page. */
  get element(): HTMLElement | null {
    return this.host;
  }

  /** The focused element inside the layer, if any. */
  get activeElement(): Element | null {
    return this.shadow?.activeElement ?? null;
  }

  /** Puts the layer in the page (a no-op while it is, or once the instance has ended). */
  mount(): void {
    if (this.host || ended) return;
    baseSheet ??= sheet(baseCss);
    this.sheets ??= [baseSheet, ...this.css.map(sheet)];
    const host = document.createElement(this.tag);
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.adoptedStyleSheets = this.sheets;
    shadow.append(this.root);
    this.host = host;
    this.shadow = shadow;
    mounted.add(this);
    this.restore();
    this.watcher = new MutationObserver(() => this.restore());
    this.watcher.observe(host, { attributes: true });
    document.documentElement.append(host);
    keepAttached();
  }

  /** Takes the layer out of the page; its root waits for the next `mount`. */
  unmount(): void {
    const host = this.host;
    if (!host) return;
    this.watcher?.disconnect();
    this.watcher = null;
    this.host = null;
    this.shadow = null;
    mounted.delete(this);
    host.remove();
    if (mounted.size === 0) releaseKeeper();
  }

  /** Sets (or with `null` removes) an important declaration on the host, kept across mounts. */
  setStyle(name: string, value: string | null): void {
    if (value === null) this.extra.delete(name);
    else this.extra.set(name, value);
    this.written = '';
    this.restore();
  }

  /**
   * Puts the host back as Atd set it: only its own inline style and `lang`, nothing else. The root
   * takes the layers' language here too, so a layer mounted after a change has it.
   */
  restore(): void {
    const host = this.host;
    if (!host) return;
    for (const name of host.getAttributeNames()) {
      if (name !== 'style' && name !== 'lang') host.removeAttribute(name);
    }
    if (host.getAttribute('style') !== this.written) {
      host.removeAttribute('style');
      for (const [name, value] of HOST_STYLE) host.style.setProperty(name, value, 'important');
      host.style.setProperty('z-index', String(Z_INDEX[this.tag]), 'important');
      for (const [name, value] of this.extra) host.style.setProperty(name, value, 'important');
      this.written = host.getAttribute('style') ?? '';
    }
    if (language && host.getAttribute('lang') !== language) host.setAttribute('lang', language);
    if (language) this.root.setAttribute('lang', language);
    // What Atd just wrote is not a page's change.
    this.watcher?.takeRecords();
  }

  /** Whether `element` is this layer's host. */
  hosts(element: unknown): boolean {
    return this.host !== null && element === this.host;
  }
}

/** The document language of every layer (fonts and line breaking follow it), from its mount on. */
export function setLayersLanguage(lang: string): void {
  language = lang;
  for (const layer of mounted) layer.restore();
}

/**
 * Whether an event's path crosses one of the extension's layers. With none in the page, no path
 * can, and the path is not built: this runs for the person's every click, key and wheel turn.
 */
export function fromOwnLayer(event: Event): boolean {
  return mounted.size > 0 && event.composedPath().some(isLayerHost);
}

/** Whether `node` is (or is inside, as far as the page's tree shows) one of the layer hosts. */
export function insideOwnLayer(node: Node | null): boolean {
  for (let current = node; current; current = current.parentNode) {
    if (isLayerHost(current)) return true;
  }
  return false;
}

function isLayerHost(node: unknown): boolean {
  for (const layer of mounted) if (layer.hosts(node)) return true;
  return false;
}

/**
 * Removes hosts an earlier instance left behind: an extension reload orphans the old content
 * script, and its replacement runs in a new isolated world that cannot tell it apart otherwise.
 */
export function removeStaleHosts(): void {
  for (const element of document.querySelectorAll(TAGS.join(','))) element.remove();
}

/** Takes every layer out for good (the extension was reloaded or removed). */
export function removeLayers(): void {
  ended = true;
  for (const layer of mounted) layer.unmount();
  releaseKeeper();
}

/**
 * Some pages replace the root element's children, or the root element itself; a mounted layer
 * then goes back under the current root.
 */
function keepAttached(): void {
  if (!keeper) {
    keeper = new MutationObserver(() => reattach());
    keeper.observe(document, { childList: true });
  }
  observeRoot();
}

function observeRoot(): void {
  const root = document.documentElement;
  if (!keeper || root === keptRoot) return;
  keptRoot = root;
  keeper.observe(root, { childList: true });
}

function reattach(): void {
  observeRoot();
  const root = document.documentElement;
  for (const layer of mounted) {
    const host = layer.element;
    if (host && host.parentNode !== root) root.append(host);
  }
}

function releaseKeeper(): void {
  keeper?.disconnect();
  keeper = null;
  keptRoot = null;
}
