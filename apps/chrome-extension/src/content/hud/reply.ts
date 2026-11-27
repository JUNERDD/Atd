import { CircleCheck, createElement } from 'lucide';
import { turnTitle, type ReplyView } from '../../messages/views.ts';
import type { RichBlock, RichInline, RichListItem } from '../../rich-text/tree.ts';
import { h, iconAttrs } from '../dom.ts';
import { t } from '../i18n.ts';
import { atdMark } from '../mark.ts';
import {
  copyButton,
  dismissButton,
  openButton,
  replyButton,
  saveButton,
  stopButton,
} from './buttons.ts';
import { card, note } from './card.ts';
import type { RunRender } from './intents.ts';
import { scrollArea } from './scroll-area.ts';

/** How close to its end (px) a reply still counts as read to the end while it grows. */
const AT_END = 4;

/**
 * A run started from this extension ends with its reply here, under the request it answers,
 * rendered from the tree the service worker parsed (`rich-text/`), clipped when the shell clipped
 * it; Copy copies its Markdown, and Reply continues the conversation in the in-page ask. A long
 * reply scrolls within the card (`scroll-area.ts`). The body stays the card's `body` part, so a
 * change in place keeps where the person had scrolled to (`parts.ts`).
 */
export function replyCard(ctx: RunRender, reply: ReplyView): HTMLElement {
  return card(
    createElement(CircleCheck, iconAttrs(16, 'ok')),
    turnTitle(ctx.run),
    replyBody(reply).parts,
    {
      trail: [
        copyButton(ctx, reply.text),
        openButton(ctx),
        saveButton(ctx),
        replyButton(ctx, 'card'),
      ],
    },
    dismissButton(ctx),
    true,
  );
}

/**
 * The card of a reply the run is writing (`state: 'writing'`): one card while the run writes and
 * nothing else on it changes, its text replaced in place as more arrives. The card arrives out of
 * the run's row as any card does; the stage then follows its growth on the in-place spring with
 * the text at its own size, as the island's answer streaming in grows (`stage.ts`,
 * `StageContent.streams`), where a new card at every update would cross the whole reply over and a
 * card scaled with its glass would swell at every line. It shares the finished card's scene and
 * body, so the answer takes its place in place: the text stays where it was read, and only the
 * glyph and the actions cross over. While the person has not scrolled up from its end, the end
 * stays in view as the text grows. The card is busy (`aria-busy`) until then, so a screen reader
 * reads the answer once rather than every update.
 */
export class WritingReply {
  private shown: {
    key: string;
    node: HTMLElement;
    viewport: HTMLElement;
    content: HTMLElement;
    text: string;
  } | null = null;

  card(ctx: RunRender, reply: ReplyView): HTMLElement {
    // A change of anything but the text (a newly clipped reply) builds the card again.
    const key = JSON.stringify([ctx.run.runId, turnTitle(ctx.run), reply.clipped]);
    if (this.shown?.key !== key) {
      const body = replyBody(reply);
      const node = card(
        atdMark(16),
        turnTitle(ctx.run),
        body.parts,
        { lead: [stopButton(ctx, 'card')], trail: [] },
        null,
        true,
      );
      node.setAttribute('aria-busy', 'true');
      this.shown = { key, node, ...body, text: reply.text };
      return node;
    }
    const shown = this.shown;
    if (shown.text !== reply.text) {
      const { viewport, content } = shown;
      const read = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= AT_END;
      content.replaceChildren(...reply.blocks.map(blockNode));
      if (read) viewport.scrollTop = viewport.scrollHeight;
      shown.text = reply.text;
    }
    return shown.node;
  }
}

/** A reply's body: its text in a scroll area, then the note when the shell clipped it. */
function replyBody(reply: ReplyView): {
  parts: HTMLElement[];
  viewport: HTMLElement;
  content: HTMLElement;
} {
  const content = h('div', { class: 'rt' }, ...reply.blocks.map(blockNode));
  const viewport = h(
    'div',
    { class: 'hud-reply scroll-viewport', attrs: { tabindex: 0, 'data-part': 'body' } },
    content,
  );
  const parts = [scrollArea(viewport, content)];
  if (reply.clipped) parts.push(note(t('hud.clipped')));
  return { parts, viewport, content };
}

/*
 * The tree as DOM: elements and text nodes only (`h`), never HTML parsing, so nothing of the
 * reply can become markup or load anything. Links open in a new tab and name where they go.
 */

function blockNode(block: RichBlock): HTMLElement {
  switch (block.type) {
    case 'paragraph':
      return h('p', {}, ...block.children.map(inlineNode));
    case 'heading':
      return h(`h${block.level}` as const, {}, ...block.children.map(inlineNode));
    case 'codeBlock':
      return h('pre', {}, h('code', {}, block.text));
    case 'list':
      return h(
        block.ordered ? 'ol' : 'ul',
        { attrs: { start: block.ordered && block.start !== 1 ? block.start : undefined } },
        ...block.items.map(itemNode),
      );
    case 'quote':
      return h('blockquote', {}, ...block.children.map(blockNode));
    case 'rule':
      return h('hr');
    case 'table':
      return tableNode(block);
  }
}

/** Names a task's box by its item's text, within the HUD's shadow root. */
let tasks = 0;

/** A task item puts its read-only box, a disabled checkbox, before its content. */
function itemNode(item: RichListItem): HTMLElement {
  const blocks = item.children.map(blockNode);
  if (item.checked === null) return h('li', {}, ...blocks);
  const id = `rt-task-${++tasks}`;
  const box = h('input', {
    class: 'rt-check',
    attrs: { type: 'checkbox', disabled: true, 'aria-labelledby': id },
  });
  box.checked = item.checked;
  return h(
    'li',
    { class: 'rt-task' },
    box,
    h('div', { class: 'rt-task-body', attrs: { id } }, ...blocks),
  );
}

function tableNode(block: Extract<RichBlock, { type: 'table' }>): HTMLElement {
  const row = (tag: 'th' | 'td', cells: readonly RichInline[][]) =>
    h(
      'tr',
      {},
      ...cells.map((cell, index) =>
        h(
          tag,
          { attrs: { 'data-align': block.align[index] ?? undefined } },
          ...cell.map(inlineNode),
        ),
      ),
    );
  return h(
    'table',
    {},
    h('thead', {}, row('th', block.head)),
    h('tbody', {}, ...block.rows.map((cells) => row('td', cells))),
  );
}

function inlineNode(node: RichInline): Node | string {
  switch (node.type) {
    case 'text':
      return node.text;
    case 'strong':
    case 'em':
    case 'del':
      return h(node.type, {}, ...node.children.map(inlineNode));
    case 'code':
      return h('code', {}, node.text);
    case 'link':
      return h(
        'a',
        {
          attrs: {
            href: node.href,
            target: '_blank',
            rel: 'noopener noreferrer',
            title: node.href,
          },
        },
        ...node.children.map(inlineNode),
      );
    case 'br':
      return h('br');
  }
}
