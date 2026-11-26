/**
 * A run's reply as the surfaces render it: a small tree of the Markdown the agent wrote, parsed
 * once by the service worker (`parse.ts`) and rendered without an HTML parser by the HUD
 * (`content/hud/reply.ts`) and the panel (`panel/rich-text.tsx`). It is plain JSON, so it rides
 * on the views, and it carries only what is safe to draw from untrusted agent output: text, the
 * formatting around it, and links whose destination is http(s) or mailto. This file has only
 * types, so the content script imports it without the parser.
 */

/** Text-level content: runs of text and the formatting that wraps them. */
export type RichInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: RichInline[] }
  | { type: 'em'; children: RichInline[] }
  | { type: 'del'; children: RichInline[] }
  | { type: 'code'; text: string }
  /** `href` is an absolute http:, https: or mailto: URL; any other link is only its text. */
  | { type: 'link'; href: string; children: RichInline[] }
  | { type: 'br' };

export type RichAlign = 'left' | 'center' | 'right' | null;

/** One list item: its blocks, and its task state (`null` for an item that is no task). */
export interface RichListItem {
  checked: boolean | null;
  children: RichBlock[];
}

export type RichBlock =
  | { type: 'paragraph'; children: RichInline[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: RichInline[] }
  /** `lang` as the fence named it ('' for none); only shown, never used to highlight. */
  | { type: 'codeBlock'; lang: string; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: RichListItem[] }
  | { type: 'quote'; children: RichBlock[] }
  | { type: 'rule' }
  /** Every row has one cell per column of `align`. */
  | { type: 'table'; align: RichAlign[]; head: RichInline[][]; rows: RichInline[][][] };
