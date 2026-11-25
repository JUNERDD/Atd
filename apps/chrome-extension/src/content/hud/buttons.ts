import { Check, Copy, RotateCcw, Square, X, Zap, createElement } from 'lucide';
import { gbtn, iconAttrs } from '../dom.ts';
import { t } from '../i18n.ts';
import type { RunRender } from './intents.ts';

/** Atd's stop glyph: Lucide Square at 12 px, filled (the product's `<Square className="size-3 fill-current" />`). */
export function stopButton(ctx: RunRender, extra?: 'lead'): HTMLButtonElement {
  const button = gbtn({
    act: 'stop',
    label: t('hud.stop'),
    icon: createElement(Square, { ...iconAttrs(12), fill: 'currentColor' }),
    onClick: () => ctx.intent({ kind: 'stop' }),
  });
  if (extra) button.classList.add(extra);
  return button;
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
