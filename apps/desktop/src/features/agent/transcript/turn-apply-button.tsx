import { writesBack } from '@atd/agent-contracts';
import { Replace, TextCursorInput } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskRun } from '../../../client/agent/task-schema';
import { IconButton } from '../../../components/icon-button';
import { showErrorToast } from '../../../components/toast-store';
import { writeAnswer } from '../command-answer';
import { useCommandRun } from '../use-command-results';

/**
 * Writes a completed command run's answer into the app the command ran from, as its output says
 * (replace the selection, or insert): the apply step of a command that waits for review, and a
 * way to apply again after an automatic write. Shown only while the run's target is remembered
 * and can take text.
 */
export function TurnApplyButton({ run, answer }: { run: TaskRun | undefined; answer: string }) {
  const { t } = useTranslation('tasks');
  const record = useCommandRun(run?.status === 'completed' ? run.id : undefined);
  const [pending, setPending] = useState(false);
  const action = record?.output.action;
  const target = record?.target;
  if (!record || !target?.writable || !action || !writesBack(action) || !answer) return null;
  if (
    target.selectionKind !== undefined &&
    target.selectionKind !== 'text' &&
    action === 'insertAfterSelection'
  )
    return null;
  const replaces = action === 'replaceSelection';

  const apply = async () => {
    setPending(true);
    try {
      await writeAnswer(record.runId, target, action, answer);
    } catch (error) {
      showErrorToast(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <IconButton
      label={
        replaces
          ? t('commandOutput.replaceIn', { app: target.app })
          : t('commandOutput.insertIn', { app: target.app })
      }
      disabled={pending}
      onClick={() => void apply()}
    >
      {replaces ? <Replace /> : <TextCursorInput />}
    </IconButton>
  );
}
