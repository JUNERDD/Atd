import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { isActive, type AgentTask } from '../../client/agent/task-schema';
import { showToast } from '../../components/toast-store';
import { automationsBridge, useAutomations } from '../automations/use-automations';

/**
 * Shows the tasks other windows and the shell ask the panel for: Continue editing an app and a
 * run's Open task in Settings (the `openTask` message), and an opened automation notification
 * (`task.open`, held by the host until this subscribes). A task deleted since the run or its
 * notification gets a notice instead of an empty task view; when the service cannot say, the
 * task opens as asked. `open` must be stable.
 */
export function useTaskOpenRequests(open: (taskId: string) => void) {
  const { t } = useTranslation('tasks');
  const show = useCallback(
    (taskId: string) => {
      const automations = window.desktop?.automations;
      if (!automations) {
        open(taskId);
        return;
      }
      void automations.taskExists(taskId).then(
        (exists) => {
          if (exists) open(taskId);
          else showToast({ kind: 'info', text: t('history.taskGone') });
        },
        () => open(taskId),
      );
    },
    [open, t],
  );
  useEffect(() => window.desktop?.apps?.onShowTask(show), [show]);
  useEffect(() => window.desktop?.onTaskOpen?.(show), [show]);
}

/**
 * Marks an automation's run read while the panel shows the task it started, so the Automations
 * list no longer offers the result as new. The service marks only a finished run, so it asks once
 * the task's run has ended (a run that ends on screen counts as seen), and again whenever the
 * automation's unread count changes meanwhile (the run's record settles a moment after the task's
 * run ends). Nothing is asked while the automation has no unread results.
 */
export function useMarkAutomationRunRead(shown: AgentTask | undefined) {
  const { automations } = useAutomations();
  const origin = shown?.origin;
  const automationId = origin?.kind === 'automation' ? origin.automationId : null;
  const unread =
    automations?.find(({ automation }) => automation.id === automationId)?.status.unread ?? 0;
  const run = shown?.runs.at(-1);
  const taskId = shown?.id ?? null;
  const settled = run !== undefined && !isActive(run.status);
  const key = taskId && settled ? `${taskId}:${run.id}:${unread}` : null;
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (!key || !taskId || !automationId || !unread || marked.current === key) return;
    marked.current = key;
    automationsBridge()
      .markRead({ taskIds: [taskId] })
      .catch((error: unknown) => {
        // Showing the task again asks again; nothing else depends on the mark.
        marked.current = null;
        console.error('The automation run could not be marked read:', error);
      });
  }, [key, taskId, automationId, unread]);
}
