import { writesBack } from '@atd/agent-contracts';
import { Replace, TextCursorInput } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FocusedWriteRequest } from '../../../client/agent/bridge';
import type { TaskRun } from '../../../client/agent/task-schema';
import { IconButton } from '../../../components/icon-button';
import { showErrorToast } from '../../../components/toast-store';
import { useCommandRun } from '../use-command-results';
import { useFocusWrite, writeAtFocus } from './turn-focus-write';

/**
 * Writes a completed write-back command run's answer where the person's focus is now, as the
 * island's answer card does (`useFocusWrite`): the focused field of the frontmost app other than
 * Atd, or of the last one while Atd is frontmost (a click on the panel activates it). Insert shows
 * while that field can take text, at its cursor, or after its selection while it has one; Replace
 * shows beside it while it has a selection. Nothing shows while the field cannot take text: the
 * apply step of a command that waits for review, and a way to apply again after an automatic
 * write, into whichever field the person is in now rather than the one the command ran from.
 */
export function TurnApplyButton({ run, answer }: { run: TaskRun | undefined; answer: string }) {
  const { t } = useTranslation('tasks');
  const record = useCommandRun(run?.status === 'completed' ? run.id : undefined);
  const focus = useFocusWrite();
  const [pending, setPending] = useState(false);
  if (!record || !writesBack(record.output.action) || !answer || !focus) return null;
  const { bridge, offer } = focus;

  const write = async (mode: FocusedWriteRequest['mode']) => {
    setPending(true);
    try {
      await writeAtFocus(bridge, answer, mode, offer.app);
    } catch (error) {
      showErrorToast(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      {offer.replaces && (
        <IconButton
          label={t('commandOutput.replaceIn', { app: offer.app })}
          disabled={pending}
          onClick={() => void write('selection')}
        >
          <Replace />
        </IconButton>
      )}
      <IconButton
        label={
          offer.replaces
            ? t('commandOutput.insertAfterIn', { app: offer.app })
            : t('commandOutput.insertIn', { app: offer.app })
        }
        disabled={pending}
        onClick={() => void write(offer.replaces ? 'afterSelection' : 'cursor')}
      >
        <TextCursorInput />
      </IconButton>
    </>
  );
}
