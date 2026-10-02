import { useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Input } from '@atd/ui/components/input';
import { isComposingKey } from '@atd/ui/lib/ime';
import type { AgentTask } from '../../client/agent/task-schema';
import { showErrorToast } from '../../components/toast-store';
import { renamedTitle, TASK_TITLE_LIMIT } from './task-title';
import { agentApi } from './use-agent';

/**
 * The panel header's title. On a task it is a button that becomes a field in place to rename the
 * task; other views show plain text. The button hugs its text, because controls are holes in the
 * window's drag regions: the rest of the header still drags the window.
 *
 * The service announces the new title after the rename resolves, so the saved name stands in
 * until the task's own title moves off the one it replaced; the header never flashes back.
 */
export function PanelTitle({ title, task }: { title: string; task: AgentTask | null }) {
  const { t } = useTranslation('panel');
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<{ from: string; to: string } | null>(null);
  const hintId = useId();
  if (!task) return <h1 title={title}>{title}</h1>;
  if (saved && task.title !== saved.from) setSaved(null);
  const shown = saved && task.title === saved.from ? saved.to : task.title;
  return (
    <>
      <h1 title={editing ? undefined : shown}>
        {editing ? (
          <TitleField
            task={task}
            current={shown}
            onDone={(to) => {
              if (to !== null) setSaved({ from: task.title, to });
              setEditing(false);
            }}
          />
        ) : (
          <Button
            variant="glass-ghost"
            size="sm"
            className="panel-title-button"
            aria-describedby={hintId}
            onClick={() => setEditing(true)}
          >
            <span className="truncate">{shown}</span>
          </Button>
        )}
      </h1>
      {/* Outside the heading, whose accessible name stays the title alone. */}
      <span id={hintId} className="sr-only">
        {t('session.rename')}
      </span>
    </>
  );
}

/**
 * The rename field, focused with its text selected. Enter or leaving the field saves, Escape keeps
 * the current name, and an empty or unchanged name saves nothing. A failed save keeps the field
 * open while it still has focus, so the name can be fixed; after a blur it closes on the old name.
 */
function TitleField({
  task,
  current,
  onDone,
}: {
  task: AgentTask;
  current: string;
  /** Closes the field with the name that was saved, or null when nothing was. */
  onDone: (saved: string | null) => void;
}): ReactElement {
  const { t } = useTranslation('panel');
  const [name, setName] = useState(current);
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  // Closing unmounts the field, and a blur may still arrive on the way out.
  const closed = useRef(false);
  useLayoutEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  function close(saved: string | null) {
    closed.current = true;
    onDone(saved);
  }
  async function commit() {
    if (closed.current || saving) return;
    const next = renamedTitle(current, name);
    if (next === null) return close(null);
    setSaving(true);
    try {
      await agentApi().renameTask(task.id, next);
      close(next);
    } catch (error) {
      showErrorToast(error);
      if (document.activeElement === field.current) setSaving(false);
      else close(null);
    }
  }
  return (
    <Input
      ref={field}
      value={name}
      maxLength={TASK_TITLE_LIMIT}
      aria-label={t('session.renameLabel')}
      aria-busy={saving || undefined}
      readOnly={saving}
      className="panel-title-field"
      onChange={(event) => setName(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (isComposingKey(event)) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          void commit();
        } else if (event.key === 'Escape') {
          // Handled here, so the panel's own Escape (leave the task) does not run as well.
          event.preventDefault();
          event.stopPropagation();
          close(null);
        }
      }}
    />
  );
}
