import { CircleCheck, createElement } from 'lucide';
import type { ReplyView } from '../../messages/views.ts';
import type { RichBlock, RichInline, RichListItem } from '../../rich-text/tree.ts';
import { h, iconAttrs } from '../dom.ts';
import { t } from '../i18n.ts';
import { copyButton, dismissButton, openButton, saveButton } from './buttons.ts';
import { card, note } from './card.ts';
import type { RunRender } from './intents.ts';
import { scrollArea } from './scroll-area.ts';

/**
 * A run started from this extension ends with its reply here, rendered from the tree the service
 * worker parsed (`rich-text/`), clipped when the shell clipped it; Copy copies its Markdown. A
 * long reply scrolls within the card (`scroll-area.ts`). The body stays the card's `body` part,
 * so a change in place keeps where the person had scrolled to (`parts.ts`).
 */
export function replyCard(ctx: RunRender, reply: ReplyView): HTMLElement {
  const content = h('div', { class: 'rt' }, ...reply.blocks.map(blockNode));
  const viewport = h(
    'div',
    { class: 'hud-reply scroll-viewport', attrs: { tabindex: 0, 'data-part': 'body' } },
    content,
  );
  return card(
    createElement(CircleCheck, iconAttrs(16, 'ok')),
    ctx.run.title,
    [scrollArea(viewport, content), reply.clipped ? note(t('hud.clipped')) : null],
    [copyButton(ctx, reply.text), openButton(ctx), saveButton(ctx)],
    dismissButton(ctx),
    true,
  );
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
