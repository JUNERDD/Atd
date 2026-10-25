import { MonitorPlay } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { showErrorToast, showToast } from '../../components/toast-store';
import { computerBridge, useComputerShellState } from './use-computer';

/** Opens the task's independent native monitor; hiding this entry does not stop its streams. */
export function ComputerLiveView({ taskId, hidden }: { taskId: string | null; hidden: boolean }) {
  const { t } = useTranslation('tasks');
  const shell = useComputerShellState();
  const sources =
    shell?.host === 'ready' ? shell.previews.filter((item) => item.taskId === taskId) : [];
  if (hidden || !taskId || !sources.length) return null;
  const labels = sources.map((source) => source.label).join(' · ');
  async function show() {
    if (!taskId) return;
    try {
      const result = await computerBridge()?.showPreview(taskId);
      if (!result?.shown) showToast({ kind: 'info', text: t('computer.preview.noSources') });
    } catch (error) {
      showErrorToast(error);
    }
  }
  return (
    <div className="mb-2 flex min-w-0 items-center gap-2">
      <Button type="button" variant="glass" size="sm" onClick={() => void show()}>
        <MonitorPlay data-icon="inline-start" />
        {t('computer.preview.showMonitor', { count: sources.length })}
      </Button>
      <span className="min-w-0 truncate text-xs text-muted-foreground" title={labels}>
        {labels}
      </span>
    </div>
  );
}
