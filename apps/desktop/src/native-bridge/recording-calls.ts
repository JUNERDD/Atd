/**
 * Questions about a screen recording or a long screenshot (`NativeRecordingCalls`, part of
 * `NativeCalls` in `calls.ts`, and `NativeRecordingEvents`, part of `NativeEvents` in
 * `contract.ts`): the capture's result card asks, the panel's page runs each question as a task
 * the panel does not show, and the card shows the answer as it grows. Loaded by the export script
 * with Node's type stripping, so it imports nothing but TypeBox and its sibling contract files (by
 * their `.ts` names) and uses only erasable TypeScript syntax.
 */
import { Type } from 'typebox';
import { NativeFileRefSchema } from './file-calls.ts';
import { Empty, MAX_CAPTURE_LENGTH, MAX_NATIVE_TEXT_LENGTH } from './primitives.ts';

/** An id the shell mints for one ask, or for one recording or long screenshot. */
const RecordingId = Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' });

/**
 * What a result card's ask is about: a screen recording's card, or a long screenshot's. The task
 * takes it as its input source, and each card keeps its own ended asks openable.
 */
const AskSource = Type.Union([Type.Literal('recording'), Type.Literal('screenshot')]);

export const NativeRecordingCalls = {
  /**
   * The answer to the ask `askId` as it stands, sent as it grows: `thinking` until its first
   * text, `streaming` with the text so far, then once `done` with the whole answer, `stopped`
   * (`recording.askStop`, or the run was stopped elsewhere) with what it had produced, or
   * `failed` with what it had produced, empty when nothing. Each update replaces the previous one;
   * nothing follows the last. `source` is the ask's (`recording.ask`), which says whose card
   * shows it. Only the panel's page sends it. The shell fails pending asks with their partial
   * text when that document unloads; the user can ask again.
   */
  'recording.answer': {
    params: Type.Object(
      {
        askId: RecordingId,
        source: AskSource,
        state: Type.Union([
          Type.Literal('thinking'),
          Type.Literal('streaming'),
          Type.Literal('done'),
          Type.Literal('stopped'),
          Type.Literal('failed'),
        ]),
        text: Type.String({ maxLength: MAX_NATIVE_TEXT_LENGTH }),
      },
      { additionalProperties: false },
    ),
    result: Empty,
  },
};

export const NativeRecordingEvents = {
  /**
   * The person asked `question` on the result card of the recording or long screenshot
   * `sourceId` (`source`): the page runs it as a new task the panel does not show, with `files`
   * attached (a recording's keyframes, or a long screenshot's kept image, and its context, as the
   * shell imported them) and `source` as its input source, and answers with `recording.answer`.
   * Sent to the panel only.
   */
  'recording.ask': Type.Object(
    {
      askId: RecordingId,
      source: AskSource,
      sourceId: RecordingId,
      question: Type.String({ minLength: 1, maxLength: MAX_CAPTURE_LENGTH }),
      files: Type.Array(NativeFileRefSchema, { maxItems: 10 }),
    },
    { additionalProperties: false },
  ),
  /** The person stopped the ask `askId`: its run stops, keeping what it had produced. */
  'recording.askStop': Type.Object({ askId: RecordingId }, { additionalProperties: false }),
  /** The person opened the ask `askId` in Atd: the panel shows its task. */
  'recording.askOpen': Type.Object({ askId: RecordingId }, { additionalProperties: false }),
};
