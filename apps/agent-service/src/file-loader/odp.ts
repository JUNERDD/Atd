import type { ExtractOutcome } from './jobs.js';
import { slidesDocument, tableRow, type SlideText } from './slides.js';
import {
  childElements,
  descendants,
  isElement,
  textValue,
  xmlEntry,
  type XmlElement,
} from './xml.js';
import { unzipBounded } from './zip.js';

const TEXT_NAMESPACE = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
/** Most spaces one `text:s` element expands to, whatever count it claims. */
const MAX_SPACES = 100;

/**
 * An OpenDocument presentation's pages (`draw:page` in `content.xml`) in order: each page's
 * paragraphs and table rows, its `presentation:notes` as speaker notes.
 */
export function odpDocument(bytes: Uint8Array, label: string): ExtractOutcome {
  const content = xmlEntry(
    unzipBounded(bytes, ({ name }) => name === 'content.xml'),
    'content.xml',
  );
  if (!content) throw new Error('it has no content.xml');
  const slides = descendants(content, 'page').map((page): SlideText => {
    const slide: SlideText = { lines: [], notes: [] };
    collect(page, slide, false);
    return slide;
  });
  return slidesDocument(label, slides, {
    facts: [],
    included: 'slide text and speaker notes; images and charts are not included',
  });
}

/** A page's paragraphs and table rows into its lines, or its notes once inside `presentation:notes`. */
function collect(node: XmlElement, slide: SlideText, inNotes: boolean): void {
  const lines = inNotes ? slide.notes : slide.lines;
  for (const child of childElements(node)) {
    if (child.localName === 'notes') collect(child, slide, true);
    else if (child.localName === 'p' || child.localName === 'h') {
      const text = paragraphText(child)
        .replace(/[ \t]+/g, ' ')
        .trim();
      if (text) lines.push(text);
    } else if (child.localName === 'table') lines.push(...tableRows(child));
    else collect(child, slide, inNotes);
  }
}

function tableRows(table: XmlElement): string[] {
  return descendants(table, 'table-row').map((row) =>
    tableRow(
      childElements(row, 'table-cell').map((cell) =>
        descendants(cell, 'p')
          .map((paragraph) => paragraphText(paragraph).trim())
          .filter(Boolean)
          .join(' '),
      ),
    ),
  );
}

/** A text paragraph with its spans, spaces (`text:s`), tabs and line breaks; notes and comments left out. */
function paragraphText(node: XmlElement): string {
  let text = '';
  for (const child of Array.from(node.childNodes)) {
    if (!isElement(child)) {
      text += textValue(child) ?? '';
      continue;
    }
    switch (child.localName) {
      case 's': {
        const count = Number(child.getAttributeNS(TEXT_NAMESPACE, 'c')) || 1;
        text += ' '.repeat(Math.min(Math.max(count, 1), MAX_SPACES));
        break;
      }
      case 'tab':
        text += '\t';
        break;
      case 'line-break':
        text += '\n';
        break;
      case 'note':
      case 'annotation':
        break;
      default:
        text += paragraphText(child);
    }
  }
  return text;
}
