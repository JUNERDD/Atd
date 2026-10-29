import path from 'node:path';
import type { ExtractOutcome } from './jobs.js';
import { slidesDocument, tableRow, type SlideText } from './slides.js';
import { childElements, descendants, ownText, xmlEntry, type XmlElement } from './xml.js';
import { unzipBounded } from './zip.js';

/** The relationships namespace of transitional and of strict OOXML. */
const RELATIONSHIP_NAMESPACES = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
];

/** Placeholders every slide repeats: slide number, date, header and footer. */
const REPEATED_PLACEHOLDERS = new Set(['sldNum', 'dt', 'hdr', 'ftr']);

interface Relationship {
  target: string;
  type: string;
}

/**
 * A PowerPoint deck's slides in presentation order (`p:sldIdLst` through the presentation's
 * relationships), each with its text paragraphs, its tables as pipe rows and the body of its notes
 * page.
 */
export function pptxDocument(bytes: Uint8Array, label: string): ExtractOutcome {
  const files = unzipBounded(
    bytes,
    ({ name }) =>
      /^ppt\/(presentation\.xml|_rels\/|slides\/|notesSlides\/)/.test(name) &&
      /\.(xml|rels)$/.test(name),
  );
  const slides: SlideText[] = slideOrder(files).map((slide) => {
    const root = xmlEntry(files, slide);
    const notesPart = [...relationships(files, slide).values()].find((relationship) =>
      relationship.type.endsWith('/notesSlide'),
    )?.target;
    const notes = notesPart ? xmlEntry(files, notesPart) : undefined;
    return {
      lines: root ? shapeLines(root, false) : [],
      notes: notes ? shapeLines(notes, true) : [],
    };
  });
  return slidesDocument(label, slides);
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

/** A part's internal relationships by id, targets resolved to archive paths. */
function relationships(files: Record<string, Uint8Array>, part: string): Map<string, Relationship> {
  const dir = path.posix.dirname(part);
  const root = xmlEntry(files, `${dir}/_rels/${path.posix.basename(part)}.rels`);
  const found = new Map<string, Relationship>();
  for (const relationship of root ? childElements(root, 'Relationship') : []) {
    const id = relationship.getAttribute('Id');
    const target = relationship.getAttribute('Target');
    if (!id || !target || relationship.getAttribute('TargetMode') === 'External') continue;
    found.set(id, {
      target: target.startsWith('/') ? target.slice(1) : path.posix.join(dir, target),
      type: relationship.getAttribute('Type') ?? '',
    });
  }
  return found;
}

function relationshipId(element: XmlElement): string {
  for (const namespace of RELATIONSHIP_NAMESPACES) {
    const id = element.getAttributeNS(namespace, 'id');
    if (id) return id;
  }
  return '';
}

/**
 * The text of a slide's or notes page's shapes in document order: a line per paragraph, a pipe row
 * per table row. A notes page contributes its notes body only, a slide everything but the
 * placeholders it repeats.
 */
function shapeLines(root: XmlElement, notesPage: boolean): string[] {
  const lines: string[] = [];
  const visit = (node: XmlElement): void => {
    for (const child of childElements(node)) {
      if (child.localName === 'sp' && skipped(child, notesPage)) continue;
      if (child.localName === 'tbl') lines.push(...tableRows(child));
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
