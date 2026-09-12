import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@ai/ui/components/alert-dialog';
import type { AgentTask } from '../../../electron/agent/task-schema';
import { isActive } from '../../../electron/agent/task-schema';
import { IconButton } from '../../components/icon-button';
import { agentApi, messageOf } from './use-agent';

export function TaskHistory({
  tasks,
  onChoose,
  onNew,
}: {
  tasks: AgentTask[];
  onChoose: (id: string) => void;
  onNew: () => void;
}) {
  const [deleting, setDeleting] = useState<AgentTask | null>(null);
  const [error, setError] = useState('');
  return (
    <section className="panel-content secondary-content" aria-label="Task history">
      <div className="section-heading">
        <h2>Your tasks</h2>
        <Button variant="ghost" size="sm" onClick={onNew}>
          New task
        </Button>
      </div>
      {!tasks.length ? (
        <div className="empty-state">
          <p>No tasks yet.</p>
          <p>Your next starting point will appear here.</p>
        </div>
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <li key={task.id} className="history-row">
              <Button
                variant="ghost"
                className="task-row min-w-0"
                onClick={() => onChoose(task.id)}
              >
                <span className="task-row-title">{task.title}</span>
                <span className="task-row-meta">
                  <time dateTime={task.updatedAt}>
                    {new Date(task.updatedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </time>
                  <span>{task.runs.at(-1)?.status.replaceAll('_', ' ') ?? 'Imported draft'}</span>
                </span>
              </Button>
              <IconButton
                label={`Delete ${task.title}`}
                disabled={isActive(task.runs.at(-1)?.status)}
                onClick={() => setDeleting(task)}
              >
                <Trash2 />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes its conversation, input copies and files in the app’s task folder. Files
              saved elsewhere and your memories remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting)
                  void agentApi()
                    .deleteTask(deleting.id)
                    .catch((error) => setError(messageOf(error)));
              }}
            >
              Delete task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
