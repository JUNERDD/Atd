import { MAX_QUOTE_PARTS, type QuoteSource } from '@ai/agent-contracts';
import { ATOMIC_BLOCKS } from './code-sources';
import type { MessagePart } from './use-message-selection';

/** The settled assistant message with a transcript block id (assistant-block.tsx). */
const BLOCK_ID = 'data-block-id';

/** A boundary point as an offset into `message`'s rendered text, its text nodes in order. */
function textOffset(message: Element, node: Node, offset: number): number {
  const prefix = document.createRange();
  prefix.selectNodeContents(message);
  prefix.setEnd(node, offset);
  return prefix.toString().length;
}

/**
 * Where the selected parts sit, to find them again: each message's block id and the part's range
 * in its text. Undefined when a message has no id or the selection is longer than a source holds;
 * the quote then works without a way back.
 */
export function quoteSource(parts: readonly MessagePart[]): QuoteSource | undefined {
  if (!parts.length || parts.length > MAX_QUOTE_PARTS) return undefined;
  const source: QuoteSource = [];
  for (const { message, range } of parts) {
    const blockId = message.getAttribute(BLOCK_ID);
    if (!blockId) return undefined;
    const start = textOffset(message, range.startContainer, range.startOffset);
    const end = textOffset(message, range.endContainer, range.endOffset);
    source.push({ blockId, start, end });
  }
  return source;
}

/** The text node and offset at `offset` in `message`'s text; a start prefers the next node. */
function textPoint(message: Element, offset: number, start: boolean) {
  const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
  let passed = 0;
  let last: Text | null = null;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!(text instanceof Text)) continue;
    const end = passed + text.length;
    if (start ? offset < end : offset <= end) return { node: text, offset: offset - passed };
    passed = end;
    last = text;
  }
  // An offset at the very end of the text (a part that runs to the message's end).
  return last && offset === passed ? { node: last, offset: last.length } : null;
}

/** A quote's passage found again: its text ranges, and the blocks it covers whole. */
export interface FoundQuote {
  ranges: Range[];
  blocks: Element[];
}

/**
 * The passage `source` names under `root`, part by part; a part whose message is gone (not loaded,
 * regenerated) or whose text no longer reaches the offsets is skipped. Null when nothing is found.
 */
export function findQuote(root: Element, source: QuoteSource): FoundQuote | null {
  const ranges: Range[] = [];
  for (const { blockId, start, end } of source) {
    const message = root.querySelector(`[${BLOCK_ID}="${CSS.escape(blockId)}"]`);
    const from = message && textPoint(message, start, true);
    const to = message && textPoint(message, end, false);
    if (!from || !to) continue;
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    ranges.push(range);
  }
  if (!ranges.length) return null;
  const blocks = Array.from(root.querySelectorAll(ATOMIC_BLOCKS)).filter((block) =>
    ranges.some((range) => range.intersectsNode(block)),
  );
  return { ranges, blocks };
}
