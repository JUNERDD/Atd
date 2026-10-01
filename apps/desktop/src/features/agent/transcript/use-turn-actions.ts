import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskRun } from '../../../client/agent/task-schema';
import { showErrorToast, showToast } from '../../../components/toast-store';
import { agentApi } from '../use-agent';
import type { AdaptedTurn } from './adapter';
import { useTaskTurns } from './turn-context';
import { markdownFileName, turnMarkdown } from './turn-markdown';
import { canResend, editableText, promptText, replacementRequest } from './turn-resend';

/** Service limit on a task title; a long source title shortens the fork's. */
const MAX_TITLE = 120;

/**
 * The settled turn's actions beyond Copy. Each is null when it does not apply, so the bar and its
 * menu list only what the turn can do: regenerating needs the task's idle last turn and its run,
 * forking needs the turn's session entry, and the exports and memory need an answer.
 */
export function useTurnActions(
  turn: AdaptedTurn,
  run: TaskRun | undefined,
  answer: string,
  last: boolean,
) {
  const { t } = useTranslation('tasks');
  const task = useTaskTurns();
  const [pending, setPending] = useState(false);
  const user = turn.user;
  const entryId = user?.entryId;
  const markdown = answer
    ? turnMarkdown(user ? promptText(user, run) : '', answer, {
        prompt: t('turnActions.markdown.prompt'),
        answer: t('turnActions.markdown.answer'),
      })
    : '';

  /** One action at a time per turn; a failure is reported and leaves the transcript as it was. */
  async function act(action: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    try {
      await action();
    } catch (error) {
      showErrorToast(error);
    } finally {
      setPending(false);
    }
  }

  const text = user ? editableText(user, run) : '';
  const regenerate =
    task && last && !task.busy && user?.prompt && entryId && run && canResend(text, run)
      ? () =>
          act(async () => {
            const request = replacementRequest(
              task.taskId,
              { ...user, entryId },
              task.runs,
              run,
              text,
            );
            await agentApi().submit(request);
          })
      : null;

  const openTask = task?.openTask;
  const fork =
    task && openTask && entryId
      ? () =>
          act(async () => {
            const title = task.title.trim()
              ? t('turnActions.forkTitle', { title: task.title }).slice(0, MAX_TITLE)
              : undefined;
            const forked = await agentApi().forkTask(task.taskId, entryId, title);
            openTask(forked.taskId);
          })
      : null;

  const copyMarkdown = markdown
    ? () =>
        act(async () => {
          await agentApi().copy(markdown);
          showToast({ kind: 'info', text: t('turnActions.markdownCopied') });
        })
    : null;

  // The save panel itself confirms the outcome, so a save reports failures only.
  const saveMarkdown =
    markdown && task
      ? () =>
          act(async () => {
            const name = markdownFileName(task.title, t('turnActions.defaultFileName'));
            await agentApi().saveMarkdown(name, markdown);
          })
      : null;

  const remember = task?.remember;
  const rememberAnswer = answer && remember ? () => remember(answer) : null;

  return { pending, regenerate, fork, copyMarkdown, saveMarkdown, remember: rememberAnswer };
}
