import { Type, type Static } from 'typebox';

/**
 * What happens with a command run's final answer once the run completes. The answer always stays in
 * the conversation; the other actions also put it somewhere:
 * - `card` shows it on the island's answer card over the app the command ran from, without opening
 *   the panel: the person reads it there, then copies it, inserts it where their focus is, or opens
 *   it in the conversation;
 * - `replaceSelection` writes it over the text that was selected in another app when the command
 *   ran (its shortcut or the selection toolbar);
 * - `insertAfterSelection` writes it right after that selection, keeping the selected text;
 * - `annotate` marks the selected text with highlights and numbered steps, its notes listed by
 *   number on the result card; only text in a screenshot can take marks, so anywhere else its
 *   answer shows on the card, as `card`'s does (`answersOnCard`);
 * - `insertAtCursor` writes it at the cursor of the app that was focused when the command ran,
 *   like typing (a selection there is replaced);
 * - `copy` puts it on the clipboard.
 *
 * The answer card and the three write-back actions need the app the command ran from, which only a
 * launch from another app (a shortcut, the selection toolbar or the screenshot toolbar) records;
 * any other launch leaves the answer in the conversation, where it can still be copied
 * (`answersInPlace`). A run on text in a screenshot (the `screenshotText` place) lands where the
 * screenshot stays open instead: `replaceSelection` replaces the picked paragraphs on the image,
 * `insertAfterSelection` and `annotate` mark them with the screenshot's own annotation tools, and
 * every other answer shows on the result card beside the screenshot (`landsOnScreenshot`).
 */
export const CommandOutputActionSchema = Type.Union([
  Type.Literal('panel'),
  Type.Literal('card'),
  Type.Literal('replaceSelection'),
  Type.Literal('insertAfterSelection'),
  Type.Literal('annotate'),
  Type.Literal('insertAtCursor'),
  Type.Literal('copy'),
]);
export type CommandOutputAction = Static<typeof CommandOutputActionSchema>;

export const CommandOutputSchema = Type.Object(
  {
    action: CommandOutputActionSchema,
    /**
     * Write-back actions and `annotate` only (`reviewable`): wait for the user to apply the answer
     * instead of writing it, or marking the screenshot with it, as soon as the run completes.
     * Ignored by `panel`, `card` and `copy`, and by `annotate` wherever it shows on the card.
     */
    review: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type CommandOutput = Static<typeof CommandOutputSchema>;

/**
 * The default of the user's typing setting (`commandTyping` in the user settings), shared by every
 * command: on, a write-back answer arrives in the other app like typing, a few characters at a time
 * (long text speeds up so it still finishes within about a second and a half); off, it is pasted at
 * once. The system's reduced-motion setting pastes every answer at once. Off by default while the
 * effect is in beta, which the setting's switch shows.
 */
export const DEFAULT_COMMAND_TYPING = false;

/**
 * The user's typing animation setting (`commandTypingAnimation`) while it was never chosen: off.
 * On, an answer written into another app leaves a trace over the field as it lands, typed or
 * pasted at once (`commandTyping`): a glow at the insertion point and a wash behind each new piece,
 * or behind the whole answer once it is in; off, it lands without one. Under the system's reduced
 * motion the wash stays and the glow does not move. The first time the typing effect is turned on
 * while the animation was never chosen, the animation turns on with it.
 */
export const DEFAULT_COMMAND_TYPING_ANIMATION = false;

/** The output of a command that never chose one: the answer stays in the conversation. */
export function defaultCommandOutput(): CommandOutput {
  return { action: 'panel', review: false };
}

/** The actions that write the answer into the app the command ran from. */
export type CommandWriteAction = Extract<
  CommandOutputAction,
  'replaceSelection' | 'insertAfterSelection' | 'insertAtCursor'
>;

/** Whether `action` writes the answer into the app the command ran from. */
export function writesBack(action: CommandOutputAction): action is CommandWriteAction {
  return (
    action === 'replaceSelection' ||
    action === 'insertAfterSelection' ||
    action === 'insertAtCursor'
  );
}

/** The actions whose answer lands where the command ran from: written there, or shown over it. */
export type CommandInPlaceAction = CommandWriteAction | 'card' | 'annotate';

/**
 * Whether `action` puts the answer where the command ran from: written into that app
 * (`writesBack`), shown on the island's answer card over it (`card`), or marked on the text it
 * ran on (`annotate`, a card wherever that text is not in a screenshot). Each needs a launch from
 * another app, or from text in a screenshot, which records where it ran; any other launch keeps
 * the answer in the conversation.
 */
export function answersInPlace(action: CommandOutputAction): action is CommandInPlaceAction {
  return action === 'card' || action === 'annotate' || writesBack(action);
}

/**
 * Whether the answer of `action` shows on the answer card where the command ran from rather than
 * being written there: `card`, and `annotate` anywhere but text in a screenshot, since only a
 * screenshot's own annotation tools can mark text.
 */
export function answersOnCard(action: CommandOutputAction): action is 'card' | 'annotate' {
  return action === 'card' || action === 'annotate';
}

/**
 * Whether `action` acts on the selection, so it is offered only to commands that read it: written
 * over or after it, or marked on it.
 */
export function actsOnSelection(action: CommandOutputAction): boolean {
  return (
    action === 'replaceSelection' || action === 'insertAfterSelection' || action === 'annotate'
  );
}

/**
 * Whether a run's answer for `action` can wait for review (`CommandOutput.review`): the write-backs,
 * and `annotate`, whose marks a screenshot previews until the person applies them.
 */
export function reviewable(action: CommandOutputAction): boolean {
  return writesBack(action) || action === 'annotate';
}
