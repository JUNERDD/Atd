import {
  ATOMIC_BLOCKS,
  atomicBlockSource,
  closestAtomicBlock,
  type CodeSource,
} from './code-sources';

/**
 * Controls that render inside a message but are not its content: buttons, decorative icons, and
 * Streamdown's action bars.
 */
const CHROME = 'button, [aria-hidden="true"], [data-streamdown$="-actions"]';

/**
 * Containers whose children only mean something inside them: list items need their list, rows
 * and cells their table. A range whose common ancestor is one of these keeps that ancestry.
 */
const STRUCTURAL = new Set(['UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR']);

/** `source` as the `<pre><code class="language-…">` shape the hast-to-mdast code handler reads. */
function fencedElement(doc: Document, source: CodeSource): HTMLPreElement {
  const pre = doc.createElement('pre');
  const code = doc.createElement('code');
  if (source.language) code.className = `language-${source.language}`;
  code.textContent = source.contents;
  pre.append(code);
  return pre;
}

/**
 * Swaps each atomic block in the clone for its whole source. `cloneContents` copies every block
 * the range intersects, partially or wholly, so the clone's blocks and the live blocks the range
 * intersects pair up in document order. A block without a recoverable source is dropped.
 */
function inlineAtomicBlocks(range: Range, fragment: DocumentFragment): void {
  const container = range.commonAncestorContainer;
  const live =
    container instanceof Element
      ? Array.from(container.querySelectorAll(ATOMIC_BLOCKS)).filter((block) =>
          range.intersectsNode(block),
        )
      : [];
  Array.from(fragment.querySelectorAll(ATOMIC_BLOCKS)).forEach((clone, index) => {
    const block = live[index];
    const source = block ? atomicBlockSource(block) : null;
    if (source) clone.replaceWith(fencedElement(clone.ownerDocument, source));
    else clone.remove();
  });
}

/**
 * Completes each cloned table against the live one it came from. A GFM table needs its header row,
 * and rows read without their column names lose their meaning, so a table without one gets the
 * live header. The row the range starts in keeps only the cells from the first selected one on,
 * so it gets empty leading cells back to stay under its columns (missing trailing cells need none).
 * Cloned tables pair with the live tables the range touches in document order: the one holding
 * the range, then those inside it.
 */
function completeTables(range: Range, content: Node): void {
  const container = range.commonAncestorContainer;
  const element = container instanceof Element ? container : container.parentElement;
  const holder = element?.closest('table');
  const inside = Array.from(element?.querySelectorAll('table') ?? []).filter((table) =>
    range.intersectsNode(table),
  );
  const live = holder ? [holder, ...inside] : inside;
  const clones =
    content instanceof Element && content.matches('table')
      ? [content]
      : content instanceof Element || content instanceof DocumentFragment
        ? Array.from(content.querySelectorAll('table'))
        : [];
  clones.forEach((clone, index) => {
    const table = live[index];
    if (!table) return;
    const columns = table.rows[0]?.cells.length ?? 0;
    const startRow = clone.querySelector('tr');
    for (let count = startRow?.children.length ?? columns; count < columns; count += 1) {
      startRow?.prepend(clone.ownerDocument.createElement(startRow.closest('thead') ? 'th' : 'td'));
    }
    const header = table.querySelector('thead');
    if (header && !clone.querySelector('thead')) clone.prepend(header.cloneNode(true));
  });
}

/** Wraps `content` in shallow copies of the structural ancestors it needs, innermost first. */
function inStructuralContext(container: Node, content: Node): Node {
  let wrapped = content;
  let element = container instanceof Element ? container : null;
  while (element && STRUCTURAL.has(element.tagName)) {
    const shell = element.cloneNode(false);
    shell.appendChild(wrapped);
    wrapped = shell;
    element = element.parentElement;
  }
  return wrapped;
}

/**
 * The DOM to convert: the enclosing atomic block's source when the range sits inside one
 * (including inside its shadow tree), else a clone of the range with atomic blocks made whole
 * and chrome removed. `null` when nothing convertible is selected.
 */
function selectedContent(range: Range): Node | null {
  const enclosing = closestAtomicBlock(range.commonAncestorContainer);
  if (enclosing) {
    const source = atomicBlockSource(enclosing);
    return source ? fencedElement(enclosing.ownerDocument, source) : null;
  }
  const fragment = range.cloneContents();
  inlineAtomicBlocks(range, fragment);
  fragment.querySelectorAll(CHROME).forEach((element) => element.remove());
  const content = inStructuralContext(range.commonAncestorContainer, fragment);
  completeTables(range, content);
  return content;
}

/** The DOM → hast → mdast → Markdown chain, loaded on first use to stay out of the entry chunk. */
async function loadConverters() {
  const [{ fromDom }, { toMdast, defaultHandlers }, { toMarkdown }, { gfmToMarkdown }] =
    await Promise.all([
      import('hast-util-from-dom'),
      import('hast-util-to-mdast'),
      import('mdast-util-to-markdown'),
      import('mdast-util-gfm'),
    ]);
  return { fromDom, toMdast, defaultHandlers, toMarkdown, gfmToMarkdown };
}

/** The selected content as Markdown: code blocks it touches whole, chrome dropped, trimmed. */
export async function selectionMarkdown(range: Range): Promise<string> {
  const content = selectedContent(range);
  if (!content) return '';
  const { fromDom, toMdast, defaultHandlers, toMarkdown, gfmToMarkdown } = await loadConverters();
  const tree = toMdast(fromDom(content), {
    handlers: {
      // Streamdown renders bold as a styled span, which the default handler would flatten.
      span: (state, element) =>
        element.properties['dataStreamdown'] === 'strong'
          ? defaultHandlers.strong(state, element)
          : state.all(element),
    },
  });
  const markdown = toMarkdown(tree, {
    extensions: [gfmToMarkdown()],
    bullet: '-',
    rule: '-',
  });
  return markdown.trim();
}
