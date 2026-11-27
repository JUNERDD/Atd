import {
  Check,
  CircleStop,
  Copy,
  type IconNode,
  Reply,
  RotateCcw,
  Square,
  X,
  Zap,
  createElement,
} from 'lucide';
import { gbtn, iconAttrs } from '../dom.ts';
import { t } from '../i18n.ts';
import type { RunRender } from './intents.ts';

/** Lucide's circle-stop with its square filled: the product's round stop button, drawn small. */
const STOP_IN_CIRCLE: IconNode = CircleStop.map(([tag, attrs]): IconNode[number] => [
  tag,
  tag === 'rect' ? { ...attrs, fill: 'currentColor' } : attrs,
]);

/**
 * Stop. A row shows Atd's stop glyph: Lucide Square at 12 px, filled (the product's
 * `<Square className="size-3 fill-current" />`). A card shows Stop under answers, where a bare
 * filled square beside a label would read as a checked checkbox, so there the square sits in its
 * circle, as the product's round stop button draws it.
 */
export function stopButton(ctx: RunRender, place: 'row' | 'card' = 'row'): HTMLButtonElement {
  return gbtn({
    act: 'stop',
    label: t('hud.stop'),
    icon:
      place === 'row'
        ? createElement(Square, { ...iconAttrs(12), fill: 'currentColor' })
        : createElement(STOP_IN_CIRCLE, iconAttrs(14)),
    onClick: () => ctx.intent({ kind: 'stop' }),
  });
}

export function openButton(ctx: RunRender, label = t('hud.openInAtd')): HTMLButtonElement {
  return gbtn({
    act: 'open',
    label,
    disabled: !ctx.reachable,
    onClick: () => ctx.intent({ kind: 'open' }),
  });
}

/**
 * Save as automation; once sent it says so, without claiming the automation exists yet. A request
 * that did not reach Atd says that instead and may be sent again. It needs Atd and its service.
 */
export function saveButton(ctx: RunRender): HTMLButtonElement {
  if (ctx.followUp === 'sent') {
    return gbtn({
      act: 'save',
      label: t('hud.sentToAtd'),
      icon: createElement(Check, iconAttrs(14)),
      disabled: true,
      onClick: () => {},
    });
  }
  const failed = ctx.followUp === 'failed';
  return gbtn({
    act: 'save',
    label: failed ? t('hud.saveFailed') : t('hud.saveAutomation'),
    icon: failed
      ? createElement(RotateCcw, iconAttrs(14, 'attn'))
      : createElement(Zap, iconAttrs(14)),
    disabled: !ctx.ready,
    onClick: () => ctx.intent({ kind: 'saveAutomation' }),
  });
}

/**
 * Reply: the in-page ask opens to continue the run's conversation. It opens whatever the
 * connection, as the ask does, and says there why Atd cannot take the reply yet. On a reply card it
 * is the primary action (`solid`); a row keeps it beside the others.
 */
export function replyButton(ctx: RunRender, place: 'row' | 'card' = 'row'): HTMLButtonElement {
  return gbtn({
    act: 'reply',
    ...(place === 'card' ? { variant: 'solid' } : {}),
    label: t('hud.reply'),
    icon: createElement(Reply, iconAttrs(14)),
    onClick: () => ctx.intent({ kind: 'reply' }),
  });
}

export function copyButton(ctx: RunRender, text: string): HTMLButtonElement {
  return gbtn({
    act: 'copy',
    label: ctx.copied ? t('common.copied') : t('common.copy'),
    icon: createElement(ctx.copied ? Check : Copy, iconAttrs(13)),
    onClick: () => ctx.intent({ kind: 'copy', text }),
  });
}

export function dismissButton(ctx: RunRender): HTMLButtonElement {
  return gbtn({
    act: 'dismiss',
    variant: 'icon',
    label: t('common.dismiss'),
    icon: createElement(X, iconAttrs(15)),
    onClick: () => ctx.intent({ kind: 'dismiss' }),
  });
}
