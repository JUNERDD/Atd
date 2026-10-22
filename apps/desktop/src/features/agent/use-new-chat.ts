import { useState } from 'react';
import type { TaskDetail } from '../../client/agent/bridge';
import type { PanelView } from './use-task-panel';
import { waitPhase, type WaitPhase } from './waiting-glow/wait-phase';

/**
 * A new chat started from the main screen: a send from the new-chat view, and the conversation
 * that send opens. Follow-ups, other conversations, and runs opened from the task history are not
 * new chats.
 *
 * - `leaving`: the send is in flight, so the welcome steps back; it returns if the send fails.
 * - `entering`: the conversation has just replaced the new-chat view and is rising into place,
 *   until its stage calls `entered`. Leaving the conversation ends it, so a later visit does not
 *   replay it.
 * - `waitPhase`: the waiting light's phase, which follows the chat through its first run.
 *
 * The send's result and its end land in one render (`sendSettling` calls both in one task), so
 * the render where `sending` turns false already shows the task it opened.
 */
export function useNewChat({
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
}): { leaving: boolean; entering: boolean; entered: () => void; waitPhase: WaitPhase } {
  const [sendingNewChat, setSendingNewChat] = useState(false);
  /** The task the latest new chat opened. */
  const [chat, setChat] = useState<string | null>(null);
  /** The task the latest new chat opened, while its conversation enters. */
  const [entering, setEntering] = useState<string | null>(null);
  if (sending && view === 'new' && !sendingNewChat) setSendingNewChat(true);
  if (sendingNewChat && !sending) {
    const opened = view === 'task' ? taskId : null;
    setSendingNewChat(false);
    setChat(opened);
    setEntering(opened);
  }
  if (entering !== null && (view !== 'task' || taskId !== entering)) setEntering(null);
  const followed = !covered && view === 'task' && taskId !== null && taskId === chat;
  return {
    leaving: sendingNewChat,
    entering: entering !== null,
    entered: () => setEntering(null),
    waitPhase: waitPhase(sendingNewChat, followed ? taskId : null, detail),
  };
}
