import { tables } from '@joplin/turndown-plugin-gfm';
import TurndownService from 'turndown';
import { documentText, wordCount } from './document.js';
import type { ExtractOutcome } from './jobs.js';

/** The element subset an image rule reads; turndown passes its DOM nodes. */
interface ImageNode {
  getAttribute(name: string): string | null;
}

let service: TurndownService | undefined;

/**
 * HTML as Markdown: headings, lists, emphasis, links and GFM tables. Scripts, styles and the
 * document head are dropped, and an image becomes its alt text, never its data or address.
 */
export function htmlToMarkdown(html: string): string {
  service ??= createService();
  return service.turndown(html).trim();
}

function createService(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  turndown.use(tables);
  turndown.remove(['head', 'script', 'style', 'title', 'noscript', 'template']);
  turndown.addRule('imageAlt', {
    filter: 'img',
    replacement: (_content: string, node: ImageNode) => {
      const alt = node.getAttribute('alt')?.trim();
      return alt ? `[Image: ${alt}]` : '';
    },
  });
  return turndown;
}

/** textutil's HTML of a document as a Markdown document under its header. */
export function htmlDocument(html: string, label: string, included: string): ExtractOutcome {
  const body = htmlToMarkdown(html);
  return {
    status: 'text',
    text: documentText({ label, facts: [wordCount(body)], included, body }),
  };
}
