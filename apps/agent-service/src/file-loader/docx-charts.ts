import { randomBytes } from 'node:crypto';
import { relatedChartLines } from './charts.js';
import { relationshipId, relationships } from './ooxml.js';
import {
  childElements,
  descendants,
  isElement,
  parseXml,
  serializeXml,
  xmlEntry,
  type XmlElement,
  type XmlNode,
} from './xml.js';

const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const BODY_PART = 'word/document.xml';

/**
 * A Word document's parts with each chart in its body replaced by a marker word, and the lines of
 * each chart's table by marker. mammoth reads no charts, so the markers carry their positions
 * through the conversion to Markdown, where `placeCharts` puts the tables. Markers hold a random
 * nonce, so text in the document cannot pass for one.
 */
export interface MarkedCharts {
  parts: Record<string, Uint8Array>;
  charts: Map<string, string[]>;
}

/**
 * Rewrites chart-bearing drawings into content mammoth can read. Grouped text boxes and pictures
 * keep their order beside chart markers; a chosen chart branch replaces its fallback preview.
 */
export function markCharts(parts: Record<string, Uint8Array>): MarkedCharts {
  const body = xmlEntry(parts, BODY_PART);
  const charts = new Map<string, string[]>();
  if (!body) return { parts, charts };
  const related = relationships(parts, BODY_PART);
  const nonce = randomBytes(6).toString('hex');
  const markerFor = (reference: XmlElement) => {
    const marker = `ATDCHART${nonce}N${charts.size + 1}Z`;
    charts.set(marker, relatedChartLines(parts, related.get(relationshipId(reference)), true));
    return marker;
  };
  for (const alternate of descendants(body, 'AlternateContent')) {
    if (chartChoice(alternate) && within(alternate, body)) rewriteDrawing(alternate, markerFor);
  }
  for (const drawing of descendants(body, 'drawing')) {
    if (descendants(drawing, 'chart').length && within(drawing, body))
      rewriteDrawing(drawing, markerFor);
  }
  if (!charts.size) return { parts, charts };
  const rewritten = new TextEncoder().encode(serializeXml(body));
  return { parts: { ...parts, [BODY_PART]: rewritten }, charts };
}

/** The Markdown with each chart marker replaced by the chart's table, as a block of its own. */
export function placeCharts(markdown: string, charts: ReadonlyMap<string, string[]>): string {
  let text = markdown;
  for (const [marker, lines] of charts) {
    // Formatting the chart's run carried may wrap the marker in emphasis.
    const placed = new RegExp(`\\s*[*_~]*${marker}[*_~]*\\s*`, 'g');
    text = text.replace(placed, () => `\n\n${lines.join('\n')}\n\n`);
  }
  return text.trim();
}

/** Flatten only drawing containers; retain Word text boxes intact for their styles and contents. */
function rewriteDrawing(element: XmlElement, markerFor: (reference: XmlElement) => string): void {
  const parent = element.parentNode;
  if (!parent || !isElement(parent)) return;
  const factory = element.ownerDocument;
  // mammoth traverses customXml but treats a wp:anchor as a single picture, losing group siblings.
  const content = factory.createElementNS(WORD_NAMESPACE, 'w:customXml');
  const visit = (node: XmlElement): void => {
    if (node.localName === 'AlternateContent') {
      const branch = chartChoice(node) ?? childElements(node, 'Fallback')[0];
      if (branch) visit(branch);
    } else if (node.localName === 'chart') {
      const run = factory.createElementNS(WORD_NAMESPACE, 'w:r');
      const text = factory.createElementNS(WORD_NAMESPACE, 'w:t');
      text.appendChild(factory.createTextNode(markerFor(node)));
      run.appendChild(text);
      content.appendChild(run);
    } else if (
      node.localName === 'txbxContent' ||
      node.localName === 'pict' ||
      (node.localName === 'drawing' && !descendants(node, 'chart').length)
    ) {
      content.appendChild(node);
    } else if (node.localName === 'pic') {
      content.appendChild(pictureDrawing(node));
    } else {
      for (const child of childElements(node)) visit(child);
    }
  };
  visit(element);
  parent.replaceChild(content, element);
}

/** Prefer the first chart-bearing Choice; other alternate content keeps mammoth's Fallback. */
function chartChoice(alternate: XmlElement): XmlElement | undefined {
  return childElements(alternate, 'Choice').find((choice) => descendants(choice, 'chart').length);
}

/** A grouped picture becomes the ordinary DrawingML shape mammoth's image callback understands. */
function pictureDrawing(picture: XmlElement): XmlElement {
  const properties = descendants(picture, 'cNvPr')[0];
  const alt = properties?.getAttribute('descr')?.trim() || properties?.getAttribute('title') || '';
  const escaped = alt.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  const links = properties
    ? childElements(properties, 'hlinkClick').map(serializeXml).join('')
    : '';
  return parseXml(
    `<w:drawing xmlns:w="${WORD_NAMESPACE}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><wp:inline><wp:docPr descr="${escaped}">${links}</wp:docPr><a:graphic><a:graphicData>${serializeXml(picture)}</a:graphicData></a:graphic></wp:inline></w:drawing>`,
  );
}

/** Whether `node` is still inside `root`, not in content an earlier marker replaced. */
function within(node: XmlNode, root: XmlElement): boolean {
  for (let current: XmlNode | null = node; current; current = current.parentNode)
    if (current === root) return true;
  return false;
}
