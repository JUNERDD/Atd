/** The text and fence language behind a rendered block. */
export type CodeSource = { contents: string; language: string };

/**
 * Sources of blocks a selection copies whole or not at all, keyed by their root element: the
 * project's code block, which paints its text in a shadow root a cloned selection cannot see, and
 * a mermaid fence, whose rendered diagram keeps only its SVG. The entry goes away with the element.
 */
const registered = new WeakMap<Element, CodeSource>();

/** Matches the roots `codeSource` marked; none of them nests in another. */
export const ATOMIC_BLOCKS = '[data-code-source]';

/** Props for a block's root that record `source` for selections and mark it as atomic. */
export function codeSource(source: CodeSource) {
  return {
    'data-code-source': '',
    ref: (element: HTMLElement | null) => {
      if (element) registered.set(element, source);
    },
  };
}

/** The source of a live atomic block, or `null` for an element `codeSource` never marked. */
export function atomicBlockSource(block: Element): CodeSource | null {
  return registered.get(block) ?? null;
}

/**
 * The atomic block holding `node`, crossing shadow roots so a node inside the code block's
 * shadow tree resolves to the block around its host.
 */
export function closestAtomicBlock(node: Node): Element | null {
  let current: Node | null = node;
  while (current) {
    const element: Element | null =
      current instanceof Element ? current : (current.parentElement ?? null);
    const block = element?.closest(ATOMIC_BLOCKS);
    if (block) return block;
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}
