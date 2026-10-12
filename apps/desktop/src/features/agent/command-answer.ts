import {
  DEFAULT_COMMAND_TYPING,
  DEFAULT_COMMAND_TYPING_ANIMATION,
  writesBack,
  type CommandWriteAction,
} from '@atd/agent-contracts';
import type { TextWriteRequest, TextWriteResult, WriteTarget } from '../../client/agent/bridge';
import { showToast } from '../../components/toast-store';
import i18n from '../../i18n';
import { readSettingsSnapshot } from '../settings/use-settings';
import { forgetCommandTarget, type SettledCommandRun } from './command-results';
import { agentApi } from './use-agent';

/** Why a write did not put the answer in (`text.write`). */
export type WriteRefusal = Extract<TextWriteResult, { ok: false }>['reason'];

const WRITE_MODES: Record<CommandWriteAction, TextWriteRequest['mode']> = {
  replaceSelection: 'selection',
  insertAfterSelection: 'afterSelection',
  insertAtCursor: 'cursor',
};

/**
 * The user's typing settings for a write: typing and its animation. A settings read that fails must
 * not hold the answer back, so the write then follows the defaults.
 */
async function typingSettings(): Promise<Pick<TextWriteRequest, 'typing' | 'animation'>> {
  try {
    const settings = await readSettingsSnapshot();
    return { typing: settings.commandTyping, animation: settings.commandTypingAnimation };
  } catch (error) {
    console.error('The typing settings could not be read:', error);
    return { typing: DEFAULT_COMMAND_TYPING, animation: DEFAULT_COMMAND_TYPING_ANIMATION };
  }
}

/** Why the answer went on the clipboard instead of into `app`, in one sentence. */
export function refusalText(reason: WriteRefusal, app: string): string {
  return i18n.t(`tasks:commandOutput.refused.${reason}`, { app });
}

/** Why the answer was not written into `app`, as the note of the island's answer card. */
export function unwrittenText(reason: Exclude<WriteRefusal, 'interrupted'>, app: string): string {
  return i18n.t(`tasks:commandOutput.unwritten.${reason}`, { app });
}

/**
 * Writes `answer` into the field run `runId` recorded in another app, as `action` says, and
 * resolves with why it did not (null once written). The shell hides the panel and confirms the
 * write by showing it, so success says nothing more; a refusal changes nothing there, and the
 * caller decides where the answer goes instead. A target the shell no longer knows is forgotten,
 * which retires the turn's apply button. The text is typed or pasted at once, with or without its
 * animation, as the user's typing settings say.
 */
export async function writeInto(
  runId: string,
  target: WriteTarget,
  action: CommandWriteAction,
  answer: string,
): Promise<WriteRefusal | null> {
  let reason: WriteRefusal;
  const typing = await typingSettings();
  try {
    const result = await agentApi().writeText({
      target: target.id,
      mode: WRITE_MODES[action],
      text: answer,
      ...typing,
    });
    if (result.ok) return null;
    reason = result.reason;
  } catch (error) {
    console.error('The native shell did not write the answer:', error);
    reason = 'failed';
  }
  if (reason === 'targetGone') forgetCommandTarget(runId);
  return reason;
}

/**
 * `writeInto`, with the whole answer put on the clipboard when it was not written: a refusal
 * changed nothing, and a write the user interrupted left only its beginning.
 */
export async function writeAnswerBack(
  runId: string,
  target: WriteTarget,
  action: CommandWriteAction,
  answer: string,
): Promise<WriteRefusal | null> {
  const reason = await writeInto(runId, target, action, answer);
  if (reason) await agentApi().copy(answer);
  return reason;
}

/** `writeAnswerBack`, with a warning that says why when the answer went on the clipboard. */
export async function writeAnswer(
  runId: string,
  target: WriteTarget,
  action: CommandWriteAction,
  answer: string,
): Promise<void> {
  const reason = await writeAnswerBack(runId, target, action, answer);
  // Each reason is one sentence: a toast shows only the first.
  if (reason) showToast({ kind: 'warning', text: refusalText(reason, target.app) });
}

/** Acts on a completed run's answer as its command's output says (`followCommandRuns`). */
export async function actOnAnswer({ run, answer }: SettledCommandRun): Promise<void> {
  const { action, review } = run.output;
  if (action === 'copy') {
    await agentApi().copy(answer);
    showToast({ kind: 'info', text: i18n.t('tasks:commandOutput.copied') });
  } else if (writesBack(action) && run.target?.writable && !review)
    // A target that cannot take text leaves the answer in the conversation the panel shows.
    await writeAnswer(run.runId, run.target, action, answer);
}
