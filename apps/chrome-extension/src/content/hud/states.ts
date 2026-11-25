import { CircleCheck, CircleStop, Hand, TriangleAlert, Unplug, createElement } from 'lucide';
import { gbtn, h, iconAttrs } from '../dom.ts';
import { t } from '../i18n.ts';
import { atdMark } from '../mark.ts';
import { dismissButton, openButton, saveButton, stopButton } from './buttons.ts';
import { answerableRequest, appNeededCard, attentionCard, replyCard } from './card.ts';
import type { RunRender } from './intents.ts';

export interface RunNode {
  node: HTMLElement;
  shape: 'row' | 'card';
}

/** The capsule's one-line anatomy: glyph, title over a detail line, a divider, then actions. */
export function hudRow(
  glyph: Element,
  title: string,
  detail: string,
  actions: readonly HTMLElement[],
  shimmer = false,
): HTMLElement {
  return h(
    'div',
    { class: 'hud-row' },
    h(
      'div',
      { class: 'hud-status' },
      h('span', { class: 'hud-glyph' }, glyph),
      h(
        'span',
        { class: 'hud-text' },
        // Titles truncate; the full text stays available on hover.
        h('span', { class: 'hud-title', attrs: { title } }, title),
        h(
          'span',
          { class: shimmer ? 'hud-sub shimmer' : 'hud-sub', attrs: { title: detail } },
          detail,
        ),
      ),
    ),
    actions.length > 0 ? h('span', { class: 'hud-div' }) : null,
    ...actions,
  );
}

/** The row Atd shows between an accepted in-page ask and the run it starts. */
export function startingRow(text: string, effects: boolean): HTMLElement {
  return hudRow(atdMark(16), text, t('hud.starting'), [], effects);
}

/** One run state, from the shell's status (or the local `stopping` right after Stop). */
export function runNode(ctx: RunRender): RunNode {
  const { run } = ctx;
  switch (ctx.status) {
    case 'working':
      return row(
        hudRow(
          atdMark(16),
          run.title,
          run.step ?? t('common.working'),
          [
            gbtn({
              act: 'takeOver',
              label: t('hud.takeOver'),
              icon: createElement(Hand, iconAttrs(15)),
              onClick: () => ctx.intent({ kind: 'takeOver' }),
            }),
            stopButton(ctx),
          ],
          ctx.effects,
        ),
      );
    case 'attention': {
      const request = answerableRequest(run);
      // A run waiting with nothing the HUD can answer is waiting in Atd itself.
      return { node: request ? attentionCard(ctx, request) : appNeededCard(ctx), shape: 'card' };
    }
    case 'held':
      return row(
        hudRow(createElement(Hand, iconAttrs(16)), t('hud.heldTitle'), t('hud.heldDetail'), [
          gbtn({
            act: 'handBack',
            variant: 'solid',
            label: t('hud.handBack'),
            onClick: () => ctx.intent({ kind: 'handBack' }),
          }),
          stopButton(ctx),
        ]),
      );
    case 'stopping': {
      // Inert until the run confirms; a spinner only once the wait is noticeable.
      const glyph = ctx.late ? h('span', { class: 'spinner' }) : atdMark(16);
      return row(hudRow(glyph, t('hud.stopping'), run.step ?? run.title, []));
    }
    case 'done':
      if (run.fromExtension && run.result) {
        return { node: replyCard(ctx, run.result), shape: 'card' };
      }
      return row(
        hudRow(createElement(CircleCheck, iconAttrs(16, 'ok')), run.title, t('hud.done'), [
          openButton(ctx),
          saveButton(ctx),
          dismissButton(ctx),
        ]),
      );
    case 'stopped':
      return row(
        hudRow(
          createElement(CircleStop, iconAttrs(16)),
          t('hud.stopped'),
          run.problem?.message ?? run.title,
          [openButton(ctx), dismissButton(ctx)],
        ),
      );
    case 'failed':
      return row(
        hudRow(
          createElement(TriangleAlert, iconAttrs(16, 'attn')),
          t('hud.failed'),
          run.problem?.message ?? run.title,
          [openButton(ctx), dismissButton(ctx)],
        ),
      );
    case 'disconnected':
      // The last known state, never claimed as progress.
      return row(
        hudRow(
          createElement(Unplug, iconAttrs(16)),
          t('hud.lostTitle'),
          run.step ? t('hud.lostStep', { step: run.step }) : t('hud.lostDetail'),
          [openButton(ctx, t('hud.openAtd'))],
        ),
      );
  }
}

function row(node: HTMLElement): RunNode {
  return { node, shape: 'row' };
}
