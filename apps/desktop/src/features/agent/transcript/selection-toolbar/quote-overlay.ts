import { ATOMIC_BLOCKS } from './code-sources';
import type { FoundQuote } from './quote-source';

/** A box in the overlay layer's coordinates, which scroll with the transcript content. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Room a tint leaves around its text, so it reads as a marker rather than a tight clip. */
const TINT_PAD_X = 2;
/** Boxes on one line closer than this merge, so a run of words and inline marks has no seams. */
const MERGE_GAP = 4;

/**
 * The visible part of `rect` once every clipping ancestor of `node` below `stop` has cut it: text in
 * a wide table or code frame that scrolls sideways can sit outside what its frame shows. Null when
 * nothing of it is visible.
 */
function clipped(rect: DOMRect, node: Node, stop: Element): DOMRect | null {
  let { left, top, right, bottom } = rect;
  for (
    let element = node.parentElement;
    element && element !== stop;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const frame = element.getBoundingClientRect();
    left = Math.max(left, frame.left);
    top = Math.max(top, frame.top);
    right = Math.min(right, frame.right);
    bottom = Math.min(bottom, frame.bottom);
  }
  return right - left > 1 && bottom - top > 1
    ? new DOMRect(left, top, right - left, bottom - top)
    : null;
}

/**
 * The line boxes of the text a range covers, one per text node per line, cut to what `stop`'s
 * clipping descendants show. The range's own
 * `getClientRects()` would also return the box of every element it fully contains (a whole
 * paragraph or table), which would tint the gaps between lines. Text inside an atomic block (a
 * diagram's source) is left to the block's ring.
 */
function textRects(range: Range, stop: Element): DOMRect[] {
  const root = range.commonAncestorContainer;
  const nodes: Node[] = [];
  // A walker never yields its own root, which is the only text node of a range inside one.
  if (root instanceof Text) nodes.push(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  const rects: DOMRect[] = [];
  for (const node of nodes) {
    if (!(node instanceof Text) || !range.intersectsNode(node)) continue;
    if (node.parentElement?.closest(ATOMIC_BLOCKS)) continue;
    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    for (const rect of part.getClientRects()) {
      const visible = clipped(rect, node, stop);
      if (visible) rects.push(visible);
    }
  }
  return rects;
}

/** Joins boxes that share a line and touch, left to right. */
function mergeLines(boxes: Box[]): Box[] {
  const merged: Box[] = [];
  const sorted = [...boxes].sort((a, b) => a.top - b.top || a.left - b.left);
  for (const box of sorted) {
    const last = merged.at(-1);
    const sameLine = last && Math.abs(last.top + last.height / 2 - (box.top + box.height / 2)) < 4;
    if (last && sameLine && box.left - (last.left + last.width) <= MERGE_GAP) {
      const right = Math.max(last.left + last.width, box.left + box.width);
      const top = Math.min(last.top, box.top);
      const bottom = Math.max(last.top + last.height, box.top + box.height);
      merged[merged.length - 1] = {
        left: last.left,
        top,
        width: right - last.left,
        height: bottom - top,
      };
    } else merged.push({ ...box });
  }
  return merged;
}

/** `rect` relative to `origin`, the layer's top-left corner in the viewport. */
function within(rect: DOMRect, origin: DOMRect): Box {
  return {
    left: rect.left - origin.left,
    top: rect.top - origin.top,
    width: rect.width,
    height: rect.height,
  };
}

function place(element: HTMLElement, box: Box) {
  element.style.left = `${box.left}px`;
  element.style.top = `${box.top}px`;
  element.style.width = `${box.width}px`;
  element.style.height = `${box.height}px`;
}

/**
 * Paints the found passage into `layer`, an empty element the transcript renders over its content
 * (agent.css `.quote-reveal-layer`): a tint behind each line of its text and a ring over each code
 * block or diagram it covers, which a tint could not show through. The overlay never touches the
 * DOM the markdown renderer owns. Returns the painted children; the caller removes them.
 */
export function paintQuote(layer: HTMLElement, { ranges, blocks }: FoundQuote): HTMLElement[] {
  const origin = layer.getBoundingClientRect();
  const stop = layer.parentElement ?? layer;
  const tints = mergeLines(
    ranges.flatMap((range) => textRects(range, stop)).map((rect) => within(rect, origin)),
  );
  const painted: HTMLElement[] = [];
  for (const box of tints) {
    const tint = document.createElement('span');
    tint.className = 'quote-reveal-tint';
    place(tint, { ...box, left: box.left - TINT_PAD_X, width: box.width + TINT_PAD_X * 2 });
    painted.push(tint);
  }
  for (const block of blocks) {
    // Each atomic block's root is its visible frame (`codeSource`), so the ring follows it.
    const ring = document.createElement('span');
    ring.className = 'quote-reveal-ring';
    place(ring, within(block.getBoundingClientRect(), origin));
    ring.style.borderRadius = getComputedStyle(block).borderRadius;
    painted.push(ring);
  }
  layer.append(...painted);
  return painted;
}
