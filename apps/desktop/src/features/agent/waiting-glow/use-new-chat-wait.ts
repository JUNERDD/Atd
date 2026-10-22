import { useState } from 'react';
import type { TaskDetail } from '../../../client/agent/bridge';
import type { PanelView } from '../use-task-panel';
import { waitPhase, type WaitPhase } from './wait-phase';

/**
 * The waiting light's phase for the panel. Only a new chat started from the main screen lights
 * it: a send from the new-chat view marks it, and the task that send opens is the one the light
 * follows, through its first run. Follow-ups, other conversations, and runs opened from the task
 * history stay dark.
 *
 * The send's result and its end land in one render (`sendSettling` calls both in one task), so
 * the render where `sending` turns false already shows the task it opened.
 */
export function useNewChatWait({
  sending,
  view,
  taskId,
  detail,
  covered,
}: {
  /** The panel's send is in flight. */
  sending: boolean;
  view: PanelView;
  /** The conversation the panel shows. */
  taskId: string | null;
  /** The latest loaded detail, which may still be another task's. */
  detail: TaskDetail | null;
  /** A drill-in or a side chat covers the conversation. */
  covered: boolean;
}): WaitPhase {
  const [sendingNewChat, setSendingNewChat] = useState(false);
  /** The task the latest new chat opened. */
  const [chat, setChat] = useState<string | null>(null);
  if (sending && view === 'new' && !sendingNewChat) setSendingNewChat(true);
  if (sendingNewChat && !sending) {
    setSendingNewChat(false);
    setChat(view === 'task' ? taskId : null);
  }
  const followed = !covered && view === 'task' && taskId !== null && taskId === chat;
  return waitPhase(sendingNewChat, followed ? taskId : null, detail);
}
