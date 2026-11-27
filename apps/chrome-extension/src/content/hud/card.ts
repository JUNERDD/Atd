import { MessageCircleQuestionMark, ShieldCheck, createElement } from 'lucide';
import type { HudRequest, RunView } from '../../channel/payloads.ts';
import { turnTitle } from '../../messages/views.ts';
import { gbtn, h, iconAttrs, type ButtonOptions } from '../dom.ts';
import { t } from '../i18n.ts';
import { openButton, stopButton } from './buttons.ts';
import type { RunRender } from './intents.ts';
import { scrollArea } from './scroll-area.ts';

type InputRequest = Extract<HudRequest, { kind: 'input' }>;

/**
 * The card anatomy: the grabber in the strip above everything, then a glyph beside title and body,
 * with a card's close button in its top trailing corner, then the card's own sections (an input's
 * choices), then its footer. Its parts are named (`data-part`; a body and a note name themselves),
 * so a change in place moves each to its place; the grabber, the same on every card, stays put.
 */
function shell(
  classes: string,
  glyph: Element,
  title: HTMLElement,
  body: readonly (HTMLElement | null)[],
  sections: readonly HTMLElement[],
  actions: HTMLElement,
  close: HTMLElement | null = null,
): HTMLElement {
  close?.classList.add('hud-card-close');
  return h(
    'div',
    { class: classes },
    grabber(),
    h(
      'div',
      { class: 'hud-card-head' },
      h('span', { class: 'hud-glyph', attrs: { 'data-part': 'glyph' } }, glyph),
      h('div', { class: 'hud-card-text' }, title, ...body),
      close,
    ),
    ...sections,
    actions,
  );
}

/**
 * A card's title. A request's title is what the person answers, so it shows in full; a run's title
 * (`clamped`) is the person's own request, which can run long, so it keeps to one line and ends in
 * an ellipsis, with the whole of it on hover.
 */
function titleNode(text: string, clamped = false): HTMLElement {
  return h(
    'div',
    {
      class: clamped ? 'hud-card-title clamped' : 'hud-card-title',
      attrs: { 'data-part': 'title', title: clamped ? text : undefined },
    },
    text,
  );
}

/**
 * The island's result cards' grabber (`IslandGrabber`): Apple's sheet grabber, centred in the strip
 * that takes the card's top padding. The whole card moves the HUD (`drag.ts`); the grabber is what
 * says so, highlighted while the pointer is near it or the HUD is dragged. Like the island's, it is
 * hidden from assistive technology: the HUD stays where it shows.
 */
function grabber(): HTMLElement {
  return h('div', { class: 'hud-grabber', attrs: { 'aria-hidden': 'true' } });
}

/**
 * A card's footer, at the trailing edge as the island's result cards' actions are: Stop first (while
 * the run can be stopped), then the card's own `actions`, its primary one last. It stays one line:
 * where the card is too narrow for every label, its secondary actions show their icons alone
 * (`compact.ts`).
 */
function footer(stop: HTMLElement | null, actions: readonly HTMLElement[]): HTMLElement {
  return h('div', { class: 'hud-card-actions' }, stop, ...actions);
}

/**
 * A run's card (its reply): the run's `title` on one line, its `body` its own section under
 * the head, as wide as the head (long text reads across the card, not in the title's column beside
 * the glyph), `close` (if any) in its top trailing corner and its footer at the trailing edge: Stop
 * (`stop`), then the card's own `actions`.
 */
export function card(
  glyph: Element,
  title: string,
  body: readonly (HTMLElement | null)[],
  { stop = null, actions = [] }: { stop?: HTMLElement | null; actions?: readonly HTMLElement[] },
  close: HTMLElement | null,
  wide = false,
): HTMLElement {
  const section = h('div', { class: 'hud-card-section' }, ...body);
  return shell(
    wide ? 'hud-card wide' : 'hud-card',
    glyph,
    titleNode(title, true),
    [],
    [section],
    footer(stop, actions),
    close,
  );
}

function bodyText(text: string): HTMLElement {
  return h('div', { class: 'hud-card-body', attrs: { 'data-part': 'body' } }, text);
}

export function note(text: string, alert = false): HTMLElement {
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
 * An input's options, each a full-width answer under the question: several are a numbered list of
 * equal choices, read top to bottom; a single one (a sign-in handoff's "I've signed in") is the
 * card's one prominent action. When the viewport cannot hold them they scroll in the HUD's scroll
 * area (`scroll-area.ts`), as a long reply does: overlay thumb, fades where more choices continue.
 */
function choices(ctx: RunRender, request: InputRequest): HTMLElement {
  const single = request.options.length === 1;
  const list = h(
    'div',
    { class: 'hud-card-choices' },
    ...request.options.map((option, index) => {
      const button = answerButton({
        act: `option-${index}`,
        variant: single ? 'solid' : 'fill',
        label: option,
        disabled: ctx.answering,
        onClick: () => ctx.intent({ kind: 'answer', request, answer: { answer: option } }),
      });
      button.classList.add('hud-choice');
      if (!single) {
        const number = String(index + 1);
        button.prepend(
          h('span', { class: 'hud-choice-index', attrs: { 'aria-hidden': 'true' } }, number),
        );
      }
      return button;
    }),
  );
  const viewport = h('div', { class: 'scroll-viewport hud-card-choices-viewport' }, list);
  const area = scrollArea(viewport, list);
  area.classList.add('hud-card-choices-area');
  return area;
}

/**
 * A request the person can answer here, the same one Atd's task panel shows (the first answer
 * given anywhere wins). A confirmation is Allow once or Don't allow; an input takes one of its
 * options (a sign-in handoff is such an input, offering "I've signed in"). The HUD sends only a
 * listed option, so an input also offers Atd for any other answer. Stop stays available, first in
 * the footer. When the page covered the card as the person answered (`guard.ts`), the card says so
 * and offers Atd instead.
 */
export function attentionCard(ctx: RunRender, request: HudRequest): HTMLElement {
  const waiting = ctx.answering;
  const covered = ctx.covered ? note(t('hud.covered'), true) : null;
  const stop = stopButton(ctx, 'card');
  if (request.kind === 'confirmation') {
    return shell(
      'hud-card',
      createElement(ShieldCheck, iconAttrs(16, 'attn')),
      titleNode(request.title),
      [request.detail ? bodyText(request.detail) : null, covered],
      [],
      footer(stop, [
        ...(ctx.covered ? [openButton(ctx, t('hud.answerInAtd'))] : []),
        answerButton({
          act: 'deny',
          variant: 'fill',
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
      ]),
    );
  }
  // Several options are the agent's own words, often a line each: the wide card wraps fewer.
  return shell(
    request.options.length > 1 ? 'hud-card wide question' : 'hud-card question',
    createElement(MessageCircleQuestionMark, iconAttrs(16, 'attn')),
    titleNode(request.title),
    [covered],
    [choices(ctx, request)],
    footer(stop, [openButton(ctx, t('hud.answerInAtd'))]),
  );
}

/** A run waiting for something the HUD cannot answer: the person goes to Atd for it. */
export function appNeededCard(ctx: RunRender): HTMLElement {
  return shell(
    'hud-card',
    createElement(MessageCircleQuestionMark, iconAttrs(16, 'attn')),
    titleNode(t('hud.needsApp')),
    [bodyText(turnTitle(ctx.run))],
    [],
    footer(stopButton(ctx, 'card'), [
      gbtn({
        act: 'open',
        variant: 'solid',
        label: t('hud.openInAtd'),
        disabled: !ctx.reachable,
        onClick: () => ctx.intent({ kind: 'open' }),
      }),
    ]),
  );
}
