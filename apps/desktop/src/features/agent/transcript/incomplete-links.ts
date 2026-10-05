/** The slice of a hast node this pass reads and rewrites. */
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { href?: unknown };
  children?: HastNode[];
};

/** remend's placeholder URL for a link whose text or URL is still streaming. */
const INCOMPLETE_LINK = 'streamdown:incomplete-link';

/**
 * remend's link or image placeholder left as text at the end of a node. When the text ends in a
 * backslash, that backslash takes the placeholder's `]` (as an escape or a `\]` closer) and only
 * the parenthesized URL is left.
 */
const STRANDED_PLACEHOLDER = /\]?\(streamdown:incomplete-(?:link|image)\)(?=\s*$)/;

const isIncompleteLink = (node: HastNode) =>
  node.type === 'element' && node.tagName === 'a' && node.properties?.href === INCOMPLETE_LINK;

/**
 * Replaces each incomplete link under `node` with its contents, and returns the last text node
 * that ends in a stranded placeholder.
 */
function resolve(node: HastNode): HastNode | undefined {
  if (node.type === 'text') return STRANDED_PLACEHOLDER.test(node.value ?? '') ? node : undefined;
  let stranded: HastNode | undefined;
  for (const child of node.children ?? []) stranded = resolve(child) ?? stranded;
  if (node.children) {
    node.children = node.children.flatMap((child) =>
      isIncompleteLink(child) ? (child.children ?? []) : [child],
    );
  }
  return stranded;
}

/**
 * Resolves remend's placeholders for unfinished links while a message streams. remend closes an
 * unfinished `[text` or `[text](https://exa` as `[text](streamdown:incomplete-link)`; Streamdown's
 * own `a` draws that as a pending link, but this renderer replaces `a` and harden's policy, so the
 * placeholder resolves here, before sanitize and harden see it:
 *
 * - A placeholder that became a link reads as its text until the URL arrives. Harden would
 *   replace it with `text [blocked]`, and the host opens only finished web links.
 * - remend closes any unmatched `[` outside code by appending the placeholder to the end of the
 *   text, even a `[` that cannot open a link: one in math (`$x \in [0,1)$`, `\left[`), an escaped
 *   `\[`, or one in an earlier block, which puts the tail in a later paragraph, table cell or
 *   open code fence. The parser keeps that tail as literal text, so the last text node ending in
 *   it drops it. Until such a `[` closes, remend also skips its later repairs (emphasis, inline
 *   code, `$$`), so their markers read raw at the streaming edge.
 *
 * Settled messages skip remend and this pass, so their text stays exactly as written.
 */
export function rehypeIncompleteLinks() {
  return (tree: HastNode) => {
    const stranded = resolve(tree);
    if (stranded?.value) stranded.value = stranded.value.replace(STRANDED_PLACEHOLDER, '');
  };
}
