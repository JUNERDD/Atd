import { useTranslation } from 'react-i18next';
import type { MemoryUnit } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { showErrorToast } from '../../components/toast-store';
import { useAgent } from '../agent/use-agent';
import { ExtensionDetailFields, type DetailField } from '../service/extension-detail-fields';
import { MEMORY_SOURCES } from './memory-labels';

/**
 * What the memory page shows about a saved unit above its fields: who wrote it, the task it came
 * from (shown in the panel on click, as Continue editing does from Settings; a task deleted since
 * is named as such), and when it was created and last changed. The task row waits for the task
 * list, so a task that is only loading never reads as deleted.
 */
export function MemoryFacts({ unit }: { unit: MemoryUnit }) {
  const { t, i18n } = useTranslation('memory');
  const { snapshot } = useAgent();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const when = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? iso
      : date.toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' });
  };
  const origin = unit.origin;
  const task = origin ? snapshot?.tasks.find((item) => item.id === origin.taskId) : undefined;
  const apps = window.desktop?.apps;
  const taskValue = task ? (
    apps ? (
      <Button
        type="button"
        variant="link"
        className="h-auto max-w-full justify-start px-0 text-left whitespace-normal"
        onClick={() => void apps.showTask(task.id).catch(showErrorToast)}
      >
        {task.title || task.id}
      </Button>
    ) : (
      task.title || task.id
    )
  ) : (
    t('memory.page.deletedTask')
  );
  const fields: DetailField[] = [
    { label: t('memory.page.source'), value: t(MEMORY_SOURCES[unit.source]) },
    ...(origin && snapshot ? [{ label: t('memory.page.task'), value: taskValue }] : []),
    { label: t('memory.page.created'), value: when(unit.created) },
    { label: t('memory.page.updated'), value: when(unit.updated) },
  ];
  return <ExtensionDetailFields fields={fields} />;
}
