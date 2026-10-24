/** One match of the query in the conversation. */
export interface FindHit {
  range: Range;
  /** The match is in one of the user's own messages, which its ruler mark tells apart. */
  mine: boolean;
}

/**
 * The text the search reads, in document order: the user's message bubbles, the activity rows'
 * labels (a phase's tally, a step's title and its target or excerpt) and the answers' markdown.
 * What a row shows only once expanded, the context captured above a message and the turn chrome
 * (headers, action bars) are not the conversation's text. Code blocks draw their text in a shadow
 * root, which a tree walk does not enter, so their code is not searched either.
 */
const HOSTS = [
  '.user-message .message-bubble',
  '.activity-group [data-slot="activity-row-title"]',
  '.activity-group [data-slot="activity-row-meta"]',
  '.assistant-block .markdown',
].join(', ');

/**
 * Text the reader does not see as the conversation's: subtrees hidden from everyone (the quote
 * reveal layer, a closing row's content, a covered layer), text only assistive technology reads,
 * drawn diagrams, the MathML twin of rendered math, and the controls an answer carries (a code
 * block's or diagram's copy and download buttons).
 */
const SKIPPED = [
  '[hidden]',
  '[inert]',
  '[aria-hidden]:not([aria-hidden="false"])',
  '.sr-only',
  'svg',
  '.katex-mathml',
  '.code-block-actions',
  '.markdown button',
].join(', ');

/** The query as a literal, case-insensitive pattern; `u` keeps match offsets in the source text. */
function patternOf(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
}

/** Whether the text in `element` shows as part of the conversation under `root`. */
function readable(element: Element, root: HTMLElement): boolean {
  const skipped = element.closest(SKIPPED);
  // Anything above `root` (the conversation covered by a layer) is not the search's concern.
  if (skipped && root.contains(skipped)) return false;
  // `display: none` or `visibility: hidden` from a stylesheet; content-visibility's skipped turns
  // still count, since they show once scrolled to.
  return (
    typeof element.checkVisibility !== 'function' ||
    element.checkVisibility({ visibilityProperty: true })
  );
}

/**
 * Every case-insensitive occurrence of `query` in the conversation under `root`, in document
 * order. A match lies within one text node, so text split by inline formatting is matched per
 * part. A host nested in another is read once, as part of the outer one.
 */
export function collectHits(root: HTMLElement, query: string): FindHit[] {
  const pattern = patternOf(query);
  const hits: FindHit[] = [];
  let outer: Element | null = null;
  for (const host of root.querySelectorAll(HOSTS)) {
    if (outer?.contains(host)) continue;
    outer = host;
    const mine = host.classList.contains('message-bubble');
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent) continue;
      // Visibility is read only for a node that matches: most text nodes do not.
      let shown: boolean | null = null;
      for (const match of (node.nodeValue ?? '').matchAll(pattern)) {
        shown ??= readable(parent, root);
        if (!shown) break;
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        hits.push({ range, mine });
      }
    }
  }
  return hits;
}

/** Highlight names, scoped to the find so no other highlight can collide with them. */
const ALL = 'conversation-find';
const CURRENT = 'conversation-find-current';

function highlightsSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
}

/**
 * Paints every match and, above them, the current one (`conversation-find.css` colors both).
 * Engines without the Custom Highlight API keep the count, the ruler and the reveal only.
 */
export function paintHits(hits: readonly FindHit[], current: number) {
  if (!highlightsSupported()) return;
  if (hits.length === 0) {
    clearHits();
    return;
  }
  CSS.highlights.set(ALL, new Highlight(...hits.map((hit) => hit.range)));
  const hit = hits[current];
  if (!hit) {
    CSS.highlights.delete(CURRENT);
    return;
  }
  const highlight = new Highlight(hit.range);
  highlight.priority = 1;
  CSS.highlights.set(CURRENT, highlight);
}

/** Removes the find's highlights. */
export function clearHits() {
  if (!highlightsSupported()) return;
  CSS.highlights.delete(ALL);
  CSS.highlights.delete(CURRENT);
}
