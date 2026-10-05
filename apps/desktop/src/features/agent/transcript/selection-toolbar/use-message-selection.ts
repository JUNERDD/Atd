import { useCallback, useEffect, useState } from 'react';
import { ATOMIC_BLOCKS } from './code-sources';

/** A settled assistant message; a streaming one replaces its nodes under the selection. */
const MESSAGE = '.assistant-block:not([data-streaming])';
/**
 * The toolbar (`SelectionToolbar`) and its portaled command menu, whose own presses must not
 * re-read or drop the selection.
 */
export const TOOLBAR = '[data-selection-toolbar]';

/** Floating UI's virtual reference: a rect to place against and the element whose scrollers move it. */
export interface SelectionAnchor {
  getBoundingClientRect(): DOMRect;
  contextElement: Element;
}

/** One settled assistant message a selection crosses, and the part of it selected. */
export interface MessagePart {
  message: Element;
  range: Range;
}

/**
 * A selection that takes in settled assistant messages. It may run across several of them and
 * whatever sits between (tool activity, thinking, the user's next message); only the messages'
 * parts are its content.
 */
export interface MessageSelection {
  /** A copy of the selected range, so later selection changes leave it intact. */
  range: Range;
  /** The selected part of each settled assistant message, in document order. */
  parts: MessagePart[];
  /** The parts' text as the page selects it, for reading aloud. */
  text: string;
  /**
   * Where the toolbar goes from the anchor: past the selection's focus, away from the selected text
   * (below a selection made downwards, above one made upwards).
   */
  side: 'top' | 'bottom';
  /** Where the selection ends: the pointer's release, or the focus caret the keyboard moved. */
  anchor: SelectionAnchor;
}

/** The element a node belongs to, seen from the document: a code block's shadow content is its host. */
function elementOf(node: Node): Element | null {
  const root = node.getRootNode();
  if (root instanceof ShadowRoot) return root.host;
  return node instanceof Element ? node : node.parentElement;
}

/**
 * The boxes of the selection's first or last line, as one rect. A line holds one box per text node
 * and inline element (a bold word, inline code), so the line is every box whose middle falls within
 * the edge box's height. With no laid-out box it falls back to the range's own.
 */
function edgeLineRect(range: Range, edge: 'start' | 'end'): DOMRect {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width && rect.height);
  const outer = edge === 'start' ? rects[0] : rects.at(-1);
  if (!outer) return range.getBoundingClientRect();
  const line = rects.filter((rect) => {
    const middle = rect.top + rect.height / 2;
    return middle >= outer.top && middle <= outer.bottom;
  });
  const left = Math.min(...line.map((rect) => rect.left));
  const right = Math.max(...line.map((rect) => rect.right));
  const top = Math.min(...line.map((rect) => rect.top));
  const bottom = Math.max(...line.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * Where the selection ends up: a zero-width rect on the line it ends on, as tall as that line, at
 * `x` when the pointer let go there, else at the focus caret the keyboard moved. A caret outside
 * that line (a drag that ended at the start of the next block) or without a box (beside a code
 * block's host) leaves the whole edge line. Read on every placement, so the anchor follows
 * scrolling and reflow.
 */
function focusRect(range: Range, caret: Range, edge: 'start' | 'end', x: number | null): DOMRect {
  const line = edgeLineRect(range, edge);
  if (x !== null) return new DOMRect(x, line.top, 0, line.height);
  const at = Array.from(caret.getClientRects()).find((rect) => rect.height > 0);
  if (!at || at.bottom <= line.top || at.top >= line.bottom) return line;
  return new DOMRect(at.left, line.top, 0, line.height);
}

/**
 * Reads the page's selection; `releaseX` is where a pointer drag let go, which the toolbar sits by
 * even past the end of a line. It is kept as an offset into the conversation, which scrolls with it.
 */
function readSelection(root: HTMLElement, releaseX: number | null): MessageSelection | null {
  const selection = document.getSelection();
  if (!selection?.focusNode || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0).cloneRange();
  const container = elementOf(range.commonAncestorContainer);
  // Inside the conversation: selecting the whole page (Select All) is not a quote of its answers.
  if (!container || !root.contains(container)) return null;
  const parts = messageParts(range, root);
  const text = parts
    .map((part) => part.range.toString().trim())
    .filter(Boolean)
    .join('\n\n');
  // A code block's text lives in its shadow root and a diagram is an SVG, outside the string.
  const blocks = Array.from(root.querySelectorAll(ATOMIC_BLOCKS));
  const touchesCode = parts.some(({ range: part }) =>
    blocks.some((block) => part.intersectsNode(block)),
  );
  if (!text && !touchesCode) return null;
  const caret = document.createRange();
  caret.setStart(selection.focusNode, selection.focusOffset);
  // A selection made forwards ends at its end; one made backwards (dragged up) at its start.
  const forward = caret.compareBoundaryPoints(Range.START_TO_START, range) !== 0;
  const edge = forward ? 'end' : 'start';
  const offset = releaseX === null ? null : releaseX - root.getBoundingClientRect().left;
  const pointerX = () => {
    if (offset === null) return null;
    const { left, right } = root.getBoundingClientRect();
    return Math.min(Math.max(left + offset, left), right);
  };
  return {
    range,
    parts,
    text,
    side: forward ? 'bottom' : 'top',
    anchor: {
      getBoundingClientRect: () => focusRect(range, caret, edge, pointerX()),
      contextElement: root,
    },
  };
}

/**
 * The part of `range` inside each settled assistant message under `root` it touches: the whole
 * message, cut at the range's start or end where they fall inside it.
 */
function messageParts(range: Range, root: HTMLElement): MessagePart[] {
  return Array.from(root.querySelectorAll(MESSAGE))
    .filter((message) => range.intersectsNode(message))
    .map((message) => {
      const part = document.createRange();
      part.selectNodeContents(message);
      if (message.contains(elementOf(range.startContainer)))
        part.setStart(range.startContainer, range.startOffset);
      if (message.contains(elementOf(range.endContainer)))
        part.setEnd(range.endContainer, range.endOffset);
      return { message, range: part };
    })
    .filter((part) => !part.range.collapsed);
}

function sameRange(a: Range, b: Range) {
  return (
    a.compareBoundaryPoints(Range.START_TO_START, b) === 0 &&
    a.compareBoundaryPoints(Range.END_TO_END, b) === 0
  );
}

/**
 * The selection that takes in settled assistant messages under `root`, or null. A pointer drag shows
 * it once the pointer lifts, where it lifted, so the toolbar does not chase the drag; keyboard
 * selection follows each change. Clearing or moving the selection out of a message hides it at once. `dismiss`
 * hides it until the selection changes again.
 */
export function useMessageSelection(root: HTMLElement | null) {
  const [selection, setSelection] = useState<MessageSelection | null>(null);
  useEffect(() => {
    if (!root) return;
    let pressed = false;
    const update = (releaseX: number | null = null) => {
      const next = readSelection(root, releaseX);
      setSelection((current) =>
        current && next && sameRange(current.range, next.range) ? current : next,
      );
    };
    const onSelectionChange = () => {
      if (!pressed) update();
      else if (!readSelection(root, null)) setSelection(null);
    };
    const fromToolbar = (event: Event) =>
      event.target instanceof Element && event.target.closest(TOOLBAR) !== null;
    const onPointerDown = (event: PointerEvent) => {
      if (!fromToolbar(event)) pressed = true;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!pressed) return;
      pressed = false;
      update(event.type === 'pointerup' ? event.clientX : null);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
    };
  }, [root]);
  const dismiss = useCallback(() => setSelection(null), []);
  return { selection, dismiss };
}
