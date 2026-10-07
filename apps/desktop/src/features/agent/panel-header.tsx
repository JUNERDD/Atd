import { History, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskDetail } from '../../client/agent/bridge';
import { IconButton } from '../../components/icon-button';
import { PanelTitle } from './panel-title';
import { SessionMenu } from './session-menu';
import { UpdateButton } from './update-button';
import type { PanelView } from './use-task-panel';

/**
 * The task panel's header on the unified title bar: the brand mark (a new chat), the view's title
 * (a conversation's renames in place), and the controls — updates, the conversation's session
 * menu, Tasks and Settings. Tasks toggles its view against the new chat.
 */
export function PanelHeader({
  view,
  taskId,
  title,
  detail,
  onNewTask,
  onToggleView,
  onOpenSettings,
}: {
  view: PanelView;
  taskId: string | null;
  title: string;
  /** The conversation on screen, once loaded; null in the other views. */
  detail: TaskDetail | null;
  onNewTask: () => void;
  onToggleView: (view: 'history') => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation('panel');
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
      <PanelTitle key={view === 'task' ? taskId : view} title={title} task={detail?.task ?? null} />
      <nav className="header-controls" aria-label={t('header.controlsLabel')}>
        <UpdateButton />
        {detail && <SessionMenu detail={detail} />}
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
