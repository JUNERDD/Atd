import { useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { IconButton } from '../../../components/icon-button';

/** Compactions after which a fresh task usually works better than another summary. */
const HINT_AFTER_COMPACTIONS = 2;

/** Tasks whose hint the user dismissed during this app session. */
const dismissed = new Set<string>();

/**
 * A quiet note at the end of a conversation compacted twice or more: each summary loses detail,
 * so a new task often does better. Dismissing it hides it for that task until the panel reloads.
 */
export function NewTaskHint({
  taskId,
  compactions,
  onNewTask,
}: {
  taskId: string;
  compactions: number;
  onNewTask: () => void;
}) {
  const { t } = useTranslation('panel');
  const [, setDismissals] = useState(0);
  if (compactions < HINT_AFTER_COMPACTIONS || dismissed.has(taskId)) return null;
  return (
    <output className="context-hint">
      <span className="context-hint-text">{t('contextHint.text', { count: compactions })}</span>
      <span className="context-hint-actions">
        <Button variant="outline" size="xs" onClick={onNewTask}>
          {t('contextHint.newTask')}
        </Button>
        <IconButton
          label={t('contextHint.dismiss')}
          size="icon-xs"
          onClick={() => {
            dismissed.add(taskId);
            setDismissals((count) => count + 1);
          }}
        >
          <X />
        </IconButton>
      </span>
    </output>
  );
}
