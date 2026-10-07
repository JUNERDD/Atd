/**
 * Rendered math (KaTeX) in a selection. A formula's glyphs, its MathML and the TeX source KaTeX
 * keeps in that MathML's `annotation` are all text nodes, so a selection that cuts into a formula
 * would read as a fragment of each. A selection takes formulas whole instead, as their TeX: a
 * display formula is the `.katex-display` block around its `.katex`, and a formula KaTeX could
 * not parse is a `.katex-error` whose text is its source.
 */

const DISPLAY = '.katex-display';
const INLINE = '.katex, .katex-error';

/** The formula holding `node`: a display block before the inline formula inside it. */
function closestFormula(node: Node): Element | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(DISPLAY) ?? element?.closest(INLINE) ?? null;
}

/** `range`, each end that falls inside a formula moved out so it takes that formula whole. */
export function wholeFormulas(range: Range): Range {
  const start = closestFormula(range.startContainer);
  const end = closestFormula(range.endContainer);
  if (start) range.setStartBefore(start);
  if (end) range.setEndAfter(end);
  return range;
}

function formulaTex(formula: Element): string {
  const annotation = formula.querySelector('annotation');
  return (annotation ?? formula).textContent ?? '';
}

/**
 * The range's text with each formula in it read once, as Markdown math (`$…$`, `$$…$$`), the way
 * the message's own text holds it.
 */
export function formulaText(range: Range): string {
  const fragment = range.cloneContents();
  if (!fragment.querySelector(`${DISPLAY}, ${INLINE}`)) return range.toString();
  // Displays first: replacing one takes its inner `.katex` with it.
  for (const formula of fragment.querySelectorAll(DISPLAY))
    formula.replaceWith(`$$${formulaTex(formula)}$$`);
  for (const formula of fragment.querySelectorAll(INLINE))
    formula.replaceWith(`$${formulaTex(formula)}$`);
  return fragment.textContent;
}
