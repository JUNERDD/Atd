import { CircleCheck, MessageCircleQuestionMark, ShieldCheck, createElement } from 'lucide';
import type { HudRequest, RunView } from '../../channel/payloads.ts';
import { gbtn, h, iconAttrs, type ButtonOptions } from '../dom.ts';
import { t } from '../i18n.ts';
import { copyButton, dismissButton, openButton, saveButton, stopButton } from './buttons.ts';
import type { RunRender } from './intents.ts';

/**
 * The card anatomy: a glyph beside title and body, actions right-aligned below. Its parts are named
 * (`data-part`; a body and a note name themselves), so a change in place moves each to its place.
 */
function card(
  glyph: Element,
  title: string,
  body: readonly (HTMLElement | null)[],
  actions: readonly HTMLElement[],
  wide = false,
): HTMLElement {
  return h(
    'div',
    { class: wide ? 'hud-card wide' : 'hud-card' },
    h(
      'div',
      { class: 'hud-card-head' },
      h('span', { class: 'hud-glyph', attrs: { 'data-part': 'glyph' } }, glyph),
      h(
        'div',
        { class: 'hud-card-text' },
        h('div', { class: 'hud-card-title', attrs: { 'data-part': 'title' } }, title),
        ...body,
      ),
    ),
    h('div', { class: 'hud-card-actions' }, ...actions),
  );
}

function bodyText(text: string): HTMLElement {
  return h('div', { class: 'hud-card-body', attrs: { 'data-part': 'body' } }, text);
}

function note(text: string, alert = false): HTMLElement {
  return h(
    'div',
    {
      class: alert ? 'hud-card-note attn' : 'hud-card-note',
      attrs: { 'data-part': 'note', role: alert ? 'alert' : undefined },
    },
    text,
  );
}

/**
 * The request an attention run shows here: a confirmation, or an input with options to pick from.
 * The shell sends only requests the HUD can answer; anything else is answered in Atd.
 */
export function answerableRequest(run: RunView): HudRequest | null {
  const request = run.requests[0];
  if (!request) return null;
  return request.kind === 'confirmation' || request.options.length > 0 ? request : null;
}

/** An answer the click guard protects (`guard.ts`): it looks inactive while the card settles. */
function answerButton(options: ButtonOptions): HTMLButtonElement {
  const button = gbtn(options);
  button.classList.add('guarded');
  return button;
}

/** The click guard's name for a request's card: a new revision is a new card. */
export function cardIdentity(request: HudRequest): string {
  return `${request.requestId}:${request.revision}`;
}

/**
 * A request the person can answer here, the same one Atd's task panel shows (the first answer
 * given anywhere wins). A confirmation is Allow once or Don't allow; an input takes one of its
 * options (a sign-in handoff is such an input, offering "I've signed in"). Stop stays available at
 * the leading edge. When the page covered the card as the person answered (`guard.ts`), the card
 * says so and offers Atd instead.
 */
export function attentionCard(ctx: RunRender, request: HudRequest): HTMLElement {
  const waiting = ctx.answering;
  const covered = ctx.covered ? note(t('hud.covered'), true) : null;
  const lead = [stopButton(ctx, 'lead'), ...(ctx.covered ? [openButton(ctx)] : [])];
  if (request.kind === 'confirmation') {
    return card(
      createElement(ShieldCheck, iconAttrs(16, 'attn')),
      request.title,
      [request.detail ? bodyText(request.detail) : null, covered],
      [
        ...lead,
        answerButton({
          act: 'deny',
          variant: 'outline',
          label: t('hud.deny'),
          disabled: waiting,
          onClick: () => ctx.intent({ kind: 'answer', request, answer: { decision: 'declined' } }),
        }),
        answerButton({
          act: 'allow',
          variant: 'solid',
          label: t('hud.allow'),
          disabled: waiting,
          onClick: () => ctx.intent({ kind: 'answer', request, answer: { decision: 'once' } }),
        }),
      ],
    );
  }
  const single = request.options.length === 1;
  return card(
    createElement(MessageCircleQuestionMark, iconAttrs(16, 'attn')),
    request.title,
    [covered],
    [
      ...lead,
      ...request.options.map((option, index) =>
        answerButton({
          act: `option-${index}`,
          variant: single ? 'solid' : 'outline',
          label: option,
          disabled: waiting,
          onClick: () => ctx.intent({ kind: 'answer', request, answer: { answer: option } }),
        }),
      ),
    ],
  );
}

/** A run waiting for something the HUD cannot answer: the person goes to Atd for it. */
export function appNeededCard(ctx: RunRender): HTMLElement {
  return card(
    createElement(MessageCircleQuestionMark, iconAttrs(16, 'attn')),
    t('hud.needsApp'),
    [bodyText(ctx.run.title)],
    [
      stopButton(ctx, 'lead'),
      gbtn({
        act: 'open',
        variant: 'solid',
        label: t('hud.openInAtd'),
        disabled: !ctx.reachable,
        onClick: () => ctx.intent({ kind: 'open' }),
      }),
    ],
  );
}

/** A run started from this extension ends with its reply here, clipped when the shell clipped it. */
export function replyCard(ctx: RunRender, result: { text: string; clipped: boolean }): HTMLElement {
  return card(
    createElement(CircleCheck, iconAttrs(16, 'ok')),
    ctx.run.title,
    [
      h(
        'div',
        { class: 'hud-card-body reply', attrs: { tabindex: 0, 'data-part': 'body' } },
        result.text,
      ),
      result.clipped ? note(t('hud.clipped')) : null,
    ],
    [copyButton(ctx, result.text), openButton(ctx), saveButton(ctx), dismissButton(ctx)],
    true,
  );
}
