import { CircleCheck, CircleStop, Hand, TriangleAlert, Unplug, createElement } from 'lucide';
import { gbtn, h, iconAttrs } from '../dom.ts';
import { t } from '../i18n.ts';
import { atdMark } from '../mark.ts';
import { canReply, turnTitle } from '../../messages/views.ts';
import { dismissButton, openButton, replyButton, saveButton, stopButton } from './buttons.ts';
import { answerableRequest, appNeededCard, attentionCard, cardIdentity } from './card.ts';
import { replyCard } from './reply.ts';
import type { RunStatus } from '../../channel/payloads.ts';
import type { RunRender } from './intents.ts';

/** What the tab's light does for the HUD's state (`edge-light.ts`). */
export type GlowMode = 'off' | 'working' | 'attention' | 'frozen' | 'done' | 'keep';

/** The light for a run's status as the HUD shows it. */
export function glowFor(status: RunStatus): GlowMode {
  switch (status) {
    case 'working':
      return 'working';
    case 'attention':
      return 'attention';
    case 'stopping':
      return 'keep';
    case 'disconnected':
      return 'frozen';
    case 'done':
      return 'done';
    case 'held':
    case 'stopped':
    case 'failed':
      return 'off';
  }
}

export interface RunNode {
  node: HTMLElement;
  shape: 'row' | 'card';
  /**
   * As the island's content kinds: each status's row is its own scene, changing in place as its
   * step or its glyph changes, and another status replaces it. So is each card, so a new request
   * or a reply replaces what showed.
   */
  scene: string;
  /** The reply the run is writing grows in place as it streams in (`StageContent.streams`). */
  streams?: boolean;
}

/**
 * The capsule's one-line anatomy: glyph, title over a detail line, a divider, then actions. Its
 * parts are named (`data-part`), so a state changing in place moves each to its new place.
 */
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
      h('span', { class: 'hud-glyph', attrs: { 'data-part': 'glyph' } }, glyph),
      h(
        'span',
        { class: 'hud-text' },
        // Titles truncate; the full text stays available on hover.
        h('span', { class: 'hud-title', attrs: { title, 'data-part': 'title' } }, title),
        h(
          'span',
          {
            class: shimmer ? 'hud-sub shimmer' : 'hud-sub',
            attrs: { title: detail, 'data-part': 'detail' },
          },
          detail,
        ),
      ),
    ),
    actions.length > 0 ? h('span', { class: 'hud-div', attrs: { 'data-part': 'divider' } }) : null,
    ...actions,
  );
}

/** The row Atd shows between an accepted in-page ask and the run it starts. */
export function startingRow(text: string, effects: boolean): HTMLElement {
  return hudRow(atdMark(16), text, t('hud.starting'), [], effects);
}

/**
 * One run state, from the shell's status (or the local `stopping` right after Stop). A run is
 * named by its turn's request (`turnTitle`), so a reply's run shows the reply, not the first
 * request; a run from this extension shows its reply as it writes it, and once its conversation
 * ended, offers Reply.
 */
export function runNode(ctx: RunRender): RunNode {
  const { run } = ctx;
  const title = turnTitle(run);
  const row = (node: HTMLElement): RunNode => ({ node, shape: 'row', scene: `row:${ctx.status}` });
  const reply = canReply(run) ? [replyButton(ctx)] : [];
  // A reply's card, the one being written included, is the run's scene until it ends: the answer
  // then takes the card's place in place.
  const replyScene = `card:reply:${run.runId}`;
  switch (ctx.status) {
    case 'working':
      // While the run writes its reply; the row comes back for a step it takes on the page, where
      // a card would cover what the agent looks at.
      if (run.fromExtension && run.result?.state === 'writing') {
        return {
          node: ctx.writing.card(ctx, run.result),
          shape: 'card',
          scene: replyScene,
          streams: true,
        };
      }
      return row(
        hudRow(
          atdMark(16),
          title,
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
      if (!request) return { node: appNeededCard(ctx), shape: 'card', scene: 'card:app' };
      const scene = `card:request:${cardIdentity(request)}`;
      return { node: attentionCard(ctx, request), shape: 'card', scene };
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
      return row(hudRow(glyph, t('hud.stopping'), run.step ?? title, []));
    }
    case 'done':
      if (run.fromExtension && run.result) {
        return { node: replyCard(ctx, run.result), shape: 'card', scene: replyScene };
      }
      return row(
        hudRow(createElement(CircleCheck, iconAttrs(16, 'ok')), title, t('hud.done'), [
          ...reply,
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
          run.problem?.message ?? title,
          [...reply, openButton(ctx), dismissButton(ctx)],
        ),
      );
    case 'failed':
      return row(
        hudRow(
          createElement(TriangleAlert, iconAttrs(16, 'attn')),
          t('hud.failed'),
          run.problem?.message ?? title,
          [...reply, openButton(ctx), dismissButton(ctx)],
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
