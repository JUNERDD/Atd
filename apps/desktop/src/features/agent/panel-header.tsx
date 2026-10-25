import { History, Search, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskContextState } from '@atd/agent-contracts';
import type { AgentTask } from '../../client/agent/task-schema';
import { IconButton } from '../../components/icon-button';
import { PanelTitle } from './panel-title';
import { SessionMenu } from './session-menu';
import { useConversationControls } from './transcript/conversation-controls';
import { HintButton } from './transcript/find/hint-button';
import { FIND_ACCELERATOR } from './transcript/find/use-find-shortcut';
import { UpdateButton } from './update-button';
import type { PanelView } from './use-task-panel';

/**
 * The task panel's header on the unified title bar: the brand mark (a new chat), the view's title
 * (a conversation's renames in place), and the controls — updates, the conversation's session
 * menu, find in the conversation, Tasks and Settings. Find shows while that conversation is the
 * one on screen and uncovered (it publishes its controls). Tasks toggles its view against the new
 * chat.
 */
export function PanelHeader({
  view,
  taskId,
  title,
  task,
  context,
  onNewTask,
  onToggleView,
  onOpenSettings,
}: {
  view: PanelView;
  taskId: string | null;
  title: string;
  /** The conversation on screen, once loaded; null in the other views. */
  task: AgentTask | null;
  /** That conversation's context state; null with no conversation. */
  context: TaskContextState | null;
  onNewTask: () => void;
  onToggleView: (view: 'history') => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation('panel');
  const controls = useConversationControls();
  const find = task && controls?.taskId === task.id ? controls.openFind : null;
  return (
    <header className="panel-header">
      <IconButton
        label={t('header.newChat')}
        variant="glass-ghost"
        className="header-button panel-brand-button -mx-1"
        data-dev={import.meta.env.DEV || undefined}
        onClick={onNewTask}
      >
        <span aria-hidden="true" className="panel-brand pointer-events-none shrink-0 bg-current" />
      </IconButton>
      <PanelTitle key={view === 'task' ? taskId : view} title={title} task={task} />
      <nav className="header-controls" aria-label={t('header.controlsLabel')}>
        <UpdateButton />
        {task && <SessionMenu task={task} context={context} />}
        {find && (
          <HintButton
            label={t('header.find')}
            accelerator={FIND_ACCELERATOR}
            variant="glass-ghost"
            className="header-button"
            onClick={find}
          >
            <Search />
          </HintButton>
        )}
        <IconButton
          label={t('header.tasks')}
          variant="glass-ghost"
          className="header-button"
          aria-pressed={view === 'history'}
          onClick={() => onToggleView('history')}
        >
          <History />
        </IconButton>
        <IconButton
          label={t('header.settings')}
          variant="glass-ghost"
          className="header-button"
          onClick={onOpenSettings}
        >
          <Settings />
        </IconButton>
      </nav>
    </header>
  );
}
