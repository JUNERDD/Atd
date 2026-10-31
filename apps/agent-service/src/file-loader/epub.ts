import path from 'node:path';
import { counted, documentText } from './document.js';
import type { ExtractOutcome } from './jobs.js';
import { htmlToMarkdown } from './markdown.js';
import { decodeXml, descendants, xmlEntry, type XmlElement } from './xml.js';
import { unzipBounded } from './zip.js';

const CONTAINER = 'META-INF/container.xml';
const ENCRYPTION = 'META-INF/encryption.xml';

/**
 * An EPUB book's chapters in reading order (container.xml, then its package document's spine),
 * each XHTML chapter as Markdown. A book whose chapters are encrypted (DRM) fails with that reason.
 */
export function epubDocument(bytes: Uint8Array, label: string): ExtractOutcome {
  const meta = unzipBounded(bytes, ({ name }) => name === CONTAINER || name === ENCRYPTION);
  const container = xmlEntry(meta, CONTAINER);
  const packagePath = container && descendants(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!packagePath) throw new Error('it names no package document');
  const packageDocument = xmlEntry(
    unzipBounded(bytes, ({ name }) => name === packagePath),
    packagePath,
  );
  if (!packageDocument) throw new Error('its package document is missing');
  const spine = spinePaths(packageDocument, path.posix.dirname(packagePath));
  const encrypted = encryptedPaths(meta);
  if (spine.some((chapter) => encrypted.has(chapter)))
    return { status: 'failed', reason: 'its chapters are encrypted (DRM)' };
  const wanted = new Set(spine);
  const files = unzipBounded(bytes, ({ name }) => wanted.has(name));
  const chapters = spine.flatMap((chapter) => {
    const data = files[chapter];
    const text = data ? htmlToMarkdown(decodeXml(data)) : '';
    return text ? [text] : [];
  });
  return {
    status: 'text',
    text: documentText({
      label,
      facts: [counted(chapters.length, 'chapter')],
      included: 'text as Markdown; images are not included',
      body: chapters.join('\n\n'),
    }),
  };
}

/** The archive paths of the spine's documents, in reading order. */
function spinePaths(packageDocument: XmlElement, base: string): string[] {
  const manifest = new Map<string, string>();
  for (const item of descendants(packageDocument, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, href);
  }
  return descendants(packageDocument, 'itemref').flatMap((reference) => {
    const href = manifest.get(reference.getAttribute('idref') ?? '');
    return href ? [path.posix.join(base, decodedPath(href.split('#', 1)[0] ?? ''))] : [];
  });
}

/** Archive paths `META-INF/encryption.xml` lists as encrypted. */
function encryptedPaths(meta: Record<string, Uint8Array>): Set<string> {
  const encryption = xmlEntry(meta, ENCRYPTION);
  const references = encryption ? descendants(encryption, 'CipherReference') : [];
  return new Set(
    references.flatMap((reference) => {
      const uri = reference.getAttribute('URI');
      return uri ? [path.posix.normalize(decodedPath(uri))] : [];
    }),
  );
}

function decodedPath(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}
