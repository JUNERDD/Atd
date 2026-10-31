import { relatedChartLines } from './charts.js';
import { counted } from './document.js';
import type { ExtractOutcome } from './jobs.js';
import { relationshipId, relationships } from './ooxml.js';
import { ExtractOutputs } from './outputs.js';
import { Pictures } from './pictures.js';
import { SlidePictures } from './slide-pictures.js';
import { slidesDocument, tableRow, type SlideText } from './slides.js';
import { childElements, descendants, ownText, xmlEntry, type XmlElement } from './xml.js';
import { unzipBounded } from './zip.js';

/** Placeholders every slide repeats: slide number, date, header and footer. */
const REPEATED_PLACEHOLDERS = new Set(['sldNum', 'dt', 'hdr', 'ftr']);

/**
 * A PowerPoint deck's slides in presentation order (`p:sldIdLst` through the presentation's
 * relationships), each with its text paragraphs, its tables as pipe rows, its charts as tables of
 * the data they cache (charts.ts) and the body of its notes page.
 */
export function pptxDocument(bytes: Uint8Array, label: string, out?: string): ExtractOutcome {
  const outputs = new ExtractOutputs(out);
  const pictures = new Pictures(outputs, out !== undefined);
  const images = new SlidePictures(pictures);
  const files = unzipBounded(
    bytes,
    ({ name }) =>
      /^ppt\/(presentation\.xml|_rels\/|slides\/|notesSlides\/|charts\/)/.test(name) &&
      /\.(xml|rels)$/.test(name),
  );
  let charts = 0;
  const slides: SlideText[] = slideOrder(files).map((slide, index) => {
    const root = xmlEntry(files, slide);
    const related = relationships(files, slide);
    const notesPart = [...related.values()].find((relationship) =>
      relationship.type.endsWith('/notesSlide'),
    )?.target;
    const notes = notesPart ? xmlEntry(files, notesPart) : undefined;
    const chart = (id: string) => {
      charts += 1;
      return relatedChartLines(files, related.get(id), false);
    };
    return {
      lines: root
        ? shapeLines(root, false, chart, (picture) =>
            images.mark(picture, related, `Slide ${index + 1}`),
          )
        : [],
      notes: notes
        ? shapeLines(
            notes,
            true,
            () => [],
            () => '',
          )
        : [],
    };
  });
  const placed = images.place(bytes);
  for (const slide of slides) slide.lines = slide.lines.map((line) => placed.get(line) ?? line);
  return slidesDocument(label, slides, {
    facts: [...(charts ? [counted(charts, 'chart')] : []), counted(pictures.count, 'image')],
    included: `slide text, tables, charts as tables of their data and speaker notes; ${pictures.included}`,
    files: outputs.summary(),
  });
}

/** Slide parts in presentation order; numbered part names when the order cannot be read. */
function slideOrder(files: Record<string, Uint8Array>): string[] {
  const presentation = xmlEntry(files, 'ppt/presentation.xml');
  const relationshipsById = relationships(files, 'ppt/presentation.xml');
  const ordered = presentation
    ? descendants(presentation, 'sldId').flatMap((slide) => {
        const target = relationshipsById.get(relationshipId(slide))?.target;
        return target && files[target] ? [target] : [];
      })
    : [];
  if (ordered.length) return ordered;
  const number = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
  return Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => number(a) - number(b));
}

/**
 * The text of a slide's or notes page's shapes in document order: a line per paragraph, a pipe row
 * per table row, `chart`'s lines for a chart frame by its relationship id. A notes page contributes
 * its notes body only, a slide everything but the placeholders it repeats. Of alternate content
 * (`mc:AlternateContent`) the first choice counts, or its fallback when the choice shows nothing
 * read here: a chart newer than the format keeps a fallback saying it cannot be shown.
 */
function shapeLines(
  root: XmlElement,
  notesPage: boolean,
  chart: (relationshipId: string) => string[],
  picture: (shape: XmlElement) => string,
): string[] {
  const lines: string[] = [];
  const visit = (node: XmlElement): void => {
    for (const child of childElements(node)) {
      if (child.localName === 'sp' && skipped(child, notesPage)) continue;
      const chartRef = child.localName === 'graphicFrame' && descendants(child, 'chart')[0];
      if (chartRef) lines.push(...chart(relationshipId(chartRef)));
      else if (child.localName === 'pic') {
        if (!notesPage) lines.push(picture(child));
      } else if (child.localName === 'AlternateContent') {
        const before = lines.length;
        const [choice] = childElements(child, 'Choice');
        if (choice) visit(choice);
        const [fallback] = childElements(child, 'Fallback');
        if (lines.length === before && fallback) visit(fallback);
      } else if (child.localName === 'tbl') lines.push(...tableRows(child));
      else if (child.localName === 'p') {
        const text = paragraphText(child);
        if (text) lines.push(text);
      } else visit(child);
    }
  };
  visit(root);
  return lines;
}

function skipped(shape: XmlElement, notesPage: boolean): boolean {
  const type = descendants(shape, 'ph')[0]?.getAttribute('type') ?? '';
  return notesPage ? type !== 'body' : REPEATED_PLACEHOLDERS.has(type);
}

function tableRows(table: XmlElement): string[] {
  return childElements(table, 'tr').map((row) =>
    tableRow(
      childElements(row, 'tc').map((cell) =>
        descendants(cell, 'p').map(paragraphText).filter(Boolean).join(' '),
      ),
    ),
  );
}

/** A DrawingML paragraph's runs (`a:t`) with its line breaks (`a:br`). */
function paragraphText(paragraph: XmlElement): string {
  const runs = (node: XmlElement): string =>
    childElements(node)
      .map((child) =>
        child.localName === 't' ? ownText(child) : child.localName === 'br' ? '\n' : runs(child),
      )
      .join('');
  return runs(paragraph)
    .replace(/[ \t]+/g, ' ')
    .trim();
}
