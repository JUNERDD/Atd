import path from 'node:path';
import { childElements, xmlEntry, type XmlElement } from './xml.js';

/** The relationships namespace of transitional and of strict OOXML. */
const RELATIONSHIP_NAMESPACES = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
];

/** An internal relationship of an Office part: the archive path it points to, and its type URI. */
export interface Relationship {
  target: string;
  type: string;
}

/**
 * A part's internal relationships by id, targets resolved to archive paths; links to external
 * files are left out, so nothing outside the archive is ever opened.
 */
export function relationships(
  files: Record<string, Uint8Array>,
  part: string,
): Map<string, Relationship> {
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

/** The relationship id (`r:id`, `r:embed`) an element names, in either namespace; '' without one. */
export function relationshipId(element: XmlElement, attribute = 'id'): string {
  for (const namespace of RELATIONSHIP_NAMESPACES) {
    const id = element.getAttributeNS(namespace, attribute);
    if (id) return id;
  }
  return '';
}
