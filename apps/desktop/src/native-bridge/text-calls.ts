/**
 * The native bridge's write-back calls (`NativeTextCalls`, part of `NativeCalls` in `calls.ts`), the
 * write target the `shortcut.command` event (`contract.ts`) carries, and the progress HUD's
 * event (`NativeTextEvents`, part of `NativeEvents`): a command run from another app (its shortcut
 * or the selection toolbar) can write its answer back into that app, and one that does so without
 * the panel shows its progress in the shell's glass status HUD. Loaded by the export script
 * with Node's type stripping, so it imports nothing but TypeBox and its sibling contract files (by
 * their `.ts` names) and uses only erasable TypeScript syntax.
 */
import { Type } from 'typebox';
import {
  CommandArgumentsSchema,
  CommandOptionsSchema,
  CommandOutputOptionSchema,
} from './command-options.ts';
import { Empty, MAX_NATIVE_TEXT_LENGTH } from './primitives.ts';

/** A write target's opaque id (`NativeWriteTargetSchema.id`). */
const WriteTargetId = Type.String({ minLength: 1, maxLength: 128 });

/**
 * The text field a summon found focused in another app, recorded before the panel could take the
 * focus. Swift keeps it for a while under `id` (an opaque token); `app` is the app's display name,
 * for labels such as "Replace in Notes". `writable` is false when Accessibility showed the focused
 * element cannot take text (a read-only text view, web content outside an editable region, an
 * element that is not text at all), so nothing is written there; it is true otherwise, including
 * when the shell cannot tell, and then the write itself says whether the text went in.
 */
export const NativeWriteTargetSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    app: Type.String({ minLength: 1, maxLength: 255 }),
    writable: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const NativeTextCalls = {
  /**
   * Writes `text` into the target app: over the selection recorded with the target (`selection`),
   * right after it (`afterSelection`), or at the focus (`cursor`, replacing a selection there like
   * typing). Swift hides the panel, brings the target app forward, restores its focused field and
   * selection, and pastes through the clipboard. A selection the summon read by a simulated ⌘C
   * (where Accessibility showed none) has no range to restore: the text goes over it as the app
   * still has it, or after it once Right Arrow collapsed it to its end, all at once. `typing` is the user's typing setting: on, the
   * text arrives like typing, a few characters at a time, in larger pieces for long text or a slow
   * field so the last of it is in within two seconds once writing starts, whatever its length; it
   * arrives all at once when off, whenever the system reduces motion, and in a field whose caret
   * cannot be followed. Each piece counts as in once the field's caret moved past it, and the call
   * resolves once the last of it is in; a piece the field does not take in time ends the write as
   * `failed` (the first) or `interrupted` (a later one). The clipboard is restored after a
   * complete write; a write that stopped short leaves its last piece there instead, so a paste still
   * in flight cannot insert the user's own clipboard. `animation` is the user's typing animation
   * setting: on, the text leaves a trace over the field as it lands, drawn by the shell on a window
   * of its own and never waited for: a glow at the insertion point and a wash behind each piece
   * while it arrives like typing, or behind the whole text once it is in when it arrives at once.
   * The trace needs the field's caret, so a field whose caret cannot be followed gets none, and
   * under reduced motion only the wash shows. A refusal
   * changes nothing: `notTrusted` (no Accessibility), `targetGone` (unknown or expired target, or
   * the app quit), `targetChanged` (the field or its selection can no longer be restored),
   * `noSelection` (a selection action on a target that recorded none), `secureInput` (a password
   * field or secure input is on), `failed` (anything else). `interrupted` is not a refusal: the
   * user pressed a key, clicked, or switched apps while the text was arriving, so only its
   * beginning was written.
   */
  'text.write': {
    params: Type.Object(
      {
        target: WriteTargetId,
        mode: Type.Union([
          Type.Literal('selection'),
          Type.Literal('afterSelection'),
          Type.Literal('cursor'),
        ]),
        text: Type.String({ minLength: 1, maxLength: MAX_NATIVE_TEXT_LENGTH }),
        typing: Type.Boolean(),
        animation: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    result: Type.Union([
      Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false }),
      Type.Object(
        {
          ok: Type.Literal(false),
          reason: Type.Union([
            Type.Literal('notTrusted'),
            Type.Literal('targetGone'),
            Type.Literal('targetChanged'),
            Type.Literal('noSelection'),
            Type.Literal('secureInput'),
            Type.Literal('failed'),
            Type.Literal('interrupted'),
          ]),
        },
        { additionalProperties: false },
      ),
    ]),
  },
  /**
   * Shows the progress HUD of a command that runs without the panel and writes its answer back (a
   * light launch), keyed by its write target `target`: the selection toolbar's glass status HUD at
   * the bottom centre of the display under the pointer, which yields its place meanwhile. It never
   * takes the focus, except in `choose`. `working`: an activity indicator, `command` (the command's
   * name), `summary` (the values it runs with, which a click reopens as `change`; absent: none
   * shown), an Esc hint and a close button that cancels; Escape cancels too while it shows,
   * without reaching the app. `choose`: the command's `options` and where its answer goes
   * (`output`) as a card the keyboard drives, answered by `run` (with every value), `edit` or
   * `cancel`. `notice`: `message` with Open and a
   * close button that dismisses it, gone by itself after a few seconds. `answer`: the run's
   * `answer` where it could not be written (its target is not `writable`, or the write was
   * refused), as a card titled `command` with `note` (why it was not written; absent: nothing
   * said) under the title, the answer scrolling within the card and selectable, Copy, Open and a
   * close button; it takes the keyboard (Escape closes it, ⌘C copies the whole answer while none
   * of it is selected) and stays until it is acted on or replaced. Copy and close are the
   * shell's own: Copy puts the answer on the clipboard and confirms it in place before the card
   * goes. One HUD shows at a time: a show for another target replaces it, one for the same target
   * changes it in place. Only the panel's page may call it.
   */
  'commandProgress.show': {
    params: Type.Object(
      {
        target: WriteTargetId,
        state: Type.Union([
          Type.Object(
            {
              phase: Type.Literal('working'),
              command: Type.String({ minLength: 1, maxLength: 200 }),
              summary: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
            },
            { additionalProperties: false },
          ),
          Type.Object(
            {
              phase: Type.Literal('choose'),
              command: Type.String({ minLength: 1, maxLength: 200 }),
              options: CommandOptionsSchema,
              output: CommandOutputOptionSchema,
            },
            { additionalProperties: false },
          ),
          Type.Object(
            {
              phase: Type.Literal('notice'),
              message: Type.String({ minLength: 1, maxLength: 500 }),
            },
            { additionalProperties: false },
          ),
          Type.Object(
            {
              phase: Type.Literal('answer'),
              command: Type.String({ minLength: 1, maxLength: 200 }),
              answer: Type.String({ minLength: 1, maxLength: MAX_NATIVE_TEXT_LENGTH }),
              note: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
            },
            { additionalProperties: false },
          ),
        ]),
      },
      { additionalProperties: false },
    ),
    result: Empty,
  },
  /**
   * Takes the progress HUD of `target` off the screen; the HUD of another target stays.
   * `text.write` does the same for its target before it brings the app forward.
   */
  'commandProgress.hide': {
    params: Type.Object({ target: WriteTargetId }, { additionalProperties: false }),
    result: Empty,
  },
};

/** The write-back posts, part of `NativePosts` in `contract.ts`. */
export const NativeTextPosts = {
  /**
   * The user's typing settings (`text.write` `typing` and `animation`), after load and on every
   * change. The shell reads them when a command is summoned, before any write: a summon from a
   * Chromium browser prepares the browser's text geometry only while the animation is on (none
   * until the first post).
   */
  'typing.set': Type.Object(
    { typing: Type.Boolean(), animation: Type.Boolean() },
    { additionalProperties: false },
  ),
};

export const NativeTextEvents = {
  /**
   * The person acted on the progress HUD of `target` (`commandProgress.show`): `cancel` (its
   * cancel button, or Escape) while it showed `working`, or the options card closed in `choose`;
   * `open` (its Open button) on a notice or an answer card; `change` (the values summary) while `working`; `run`
   * (with `arguments`, every value the card shows) or `edit` (an input option handed to the panel)
   * in `choose`. After `change` the page shows `choose` for the same target; after any other
   * action the HUD is already gone. Sent to the panel only.
   */
  'commandProgress.action': Type.Object(
    {
      target: WriteTargetId,
      action: Type.Union([
        Type.Literal('cancel'),
        Type.Literal('open'),
        Type.Literal('change'),
        Type.Literal('run'),
        Type.Literal('edit'),
      ]),
      arguments: Type.Optional(CommandArgumentsSchema),
    },
    { additionalProperties: false },
  ),
};
