import { useTranslation } from 'react-i18next';
import { showErrorToast, showToast } from '../../components/toast-store';
import { computerBridge, useComputerShellState } from './use-computer';

/** The task's live screens, which the status capsule offers to watch in the native monitor. */
export interface ComputerMonitor {
  /** How many sources the task streams. */
  count: number;
  /** Their names, for the part's tooltip and accessible name. */
  labels: string;
  /** Opens the task's independent native Screen Monitor. */
  show: () => void;
}

/**
 * The task's screen monitor entry, or null while it streams nothing. Hiding the entry (another
 * task, a hidden composer) does not stop the streams; the monitor window owns them.
 */
export function useComputerMonitor(taskId: string | null): ComputerMonitor | null {
  const { t } = useTranslation('tasks');
  const shell = useComputerShellState();
  const sources =
    shell?.host === 'ready' ? shell.previews.filter((item) => item.taskId === taskId) : [];
  if (!taskId || !sources.length) return null;
  async function show(id: string) {
    try {
      const result = await computerBridge()?.showPreview(id);
      if (!result?.shown) showToast({ kind: 'info', text: t('computer.preview.noSources') });
    } catch (error) {
      showErrorToast(error);
    }
  }
  return {
    count: sources.length,
    labels: sources.map((source) => source.label).join(' · '),
    show: () => void show(taskId),
  };
}
