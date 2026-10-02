import type { Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView } from '@codemirror/view';

/**
 * How much narrower than the one-line row a wrapped draft must be before the composer collapses
 * again, so a draft at the boundary does not flip between the two layouts as it reflows.
 */
const COLLAPSE_MARGIN = 8;

/**
 * Width a single wrapped line would take on one row: the union of its boxes on each visual line,
 * summed. Chips are inline-block boxes with boxes inside them, so lines are measured by extent,
 * not by adding every box.
 */
function oneRowWidth(view: EditorView): number {
  const line = view.contentDOM.querySelector('.cm-line');
  if (!line) return 0;
  const range = document.createRange();
  range.selectNodeContents(line);
  const rows = new Map<number, { left: number; right: number }>();
  for (const rect of range.getClientRects()) {
    if (!rect.width) continue;
    const key = Math.round(rect.top + rect.height / 2);
    const row = [...rows.entries()].find(([middle]) => Math.abs(middle - key) < rect.height / 2);
    if (row) {
      row[1].left = Math.min(row[1].left, rect.left);
      row[1].right = Math.max(row[1].right, rect.right);
    } else rows.set(key, { left: rect.left, right: rect.right });
  }
  let width = 0;
  for (const { left, right } of rows.values()) width += right - left;
  return width;
}

/**
 * Reports whether the draft needs more than the composer's one-line row: a line break, or content
 * (text and chips alike) wider than the row. Measured from layout, since a chip's serialized text
 * says nothing about how wide it draws. Collapsed, the row overflows sideways; expanded (wrapping),
 * the draft fits again once its one-row width clears the collapsed row's width, which is taken
 * from the last collapsed measure and shifted by any resize since.
 */
export function overflowWatcher(report: (overflowing: boolean) => void): Extension {
  return ViewPlugin.define((view) => {
    let collapsedWidth: number | null = null;
    let wrappedWidth: number | null = null;
    const measure = {
      // One pending measure per view: a newer request replaces the scheduled one.
      key: {},
      read(current: EditorView): boolean {
        if (current.state.doc.lines > 1) return true;
        const width = current.scrollDOM.clientWidth;
        if (!current.lineWrapping) {
          collapsedWidth = width;
          wrappedWidth = null;
          return current.scrollDOM.scrollWidth > width + 1;
        }
        // Wrapped since mount, with no collapsed row measured: collapse, and let that measure decide.
        if (collapsedWidth === null) return false;
        const wrapped = (wrappedWidth ??= width);
        const room = collapsedWidth + (width - wrapped);
        return oneRowWidth(current) > room - COLLAPSE_MARGIN;
      },
      write: report,
    };
    view.requestMeasure(measure);
    // A chip draws its label in its own React root after CodeMirror lays out the line, so its width
    // arrives without a document or geometry change; the content's own size catches it.
    const resized = new ResizeObserver(() => view.requestMeasure(measure));
    resized.observe(view.contentDOM);
    return {
      update(update) {
        if (update.docChanged || update.geometryChanged) update.view.requestMeasure(measure);
      },
      destroy() {
        resized.disconnect();
      },
    };
  });
}
