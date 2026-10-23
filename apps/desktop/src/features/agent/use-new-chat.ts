import { useState, type AnimationEvent } from 'react';
import type { TaskDetail } from '../../client/agent/bridge';
import type { ComposerContent } from '../../components/composer-content';
import type { ComposerDispatch } from '../../components/composer-dispatch';
import type { Flight } from './message-flight';
import type { PanelView } from './use-task-panel';
import { waitPhase } from './waiting-glow/wait-phase';

/** The first turn's arrival around its message (`agent.css`), whose end ends `entering`. */
const TURN_ARRIVE = 'turn-arrive';

/**
 * A new chat started from the main screen: a send from the new-chat view, and the conversation
 * that send opens. Follow-ups, other conversations, and runs opened from the task history are not
 * new chats. One motion carries it: the message is captured as the send starts (`depart`,
 * `MessageFlight`) and hands over to its arriving bubble once the conversation shows, while the
 * welcome steps back and the rest of the first turn arrives around the message.
 *
 * - `welcome`: the welcome steps back while the send is out (`leaving`) and gives way to the
 *   conversation it opened (`toChat`); it returns if the send fails.
 * - `stage`: the conversation's first turn is arriving (`data-entering`) until its fade has run.
 * - `flight` and `dispatch`: the sent message on its way, and the composer under it, until the
 *   message has landed or, refused, dropped back into the composer.
 * - `composerKey`: the composer that sent the chat goes on serving the conversation it opened, so
 *   neither its editor nor its change of shape restarts when the page changes.
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
}) {
  const [sendingNewChat, setSendingNewChat] = useState(false);
  /** The task the latest new chat opened. */
  const [chat, setChat] = useState<string | null>(null);
  /** The task the latest new chat opened, while its first turn arrives. */
  const [entering, setEntering] = useState<string | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [sourceHidden, setSourceHidden] = useState(false);
  if (sending && view === 'new' && !sendingNewChat) setSendingNewChat(true);
  if (sendingNewChat && !sending) {
    const opened = view === 'task' ? taskId : null;
    setSendingNewChat(false);
    setChat(opened);
    setEntering(opened);
    if (flight) setFlight({ ...flight, outcome: opened === null ? 'refused' : 'opened' });
  } else if (flight?.outcome === 'sending' && !sendingNewChat && !sending) {
    // The panel refused the send before it started, so the draft never left the composer.
    setFlight(null);
  }
  if (entering !== null && (view !== 'task' || taskId !== entering)) setEntering(null);
  // Leaving the conversation mid-flight leaves nowhere to land.
  if (flight?.outcome === 'opened' && (view !== 'task' || taskId !== chat)) setFlight(null);
  const followed = !covered && view === 'task' && taskId !== null && taskId === chat;
  const dispatch: ComposerDispatch | null =
    flight && flight.outcome !== 'refused'
      ? {
          hidden: flight.outcome === 'sending',
          holding: !sourceHidden,
          from: flight.content.surface,
        }
      : null;
  return {
    welcome: { leaving: sendingNewChat, toChat: entering !== null },
    stage: {
      'data-entering': entering !== null ? '' : undefined,
      'data-message-flight': flight?.outcome === 'opened' ? '' : undefined,
      onAnimationEnd: (event: AnimationEvent<HTMLDivElement>) => {
        if (!flight && event.animationName === TURN_ARRIVE) setEntering(null);
      },
    },
    flight: flight && {
      flight,
      onSourceHidden: () => setSourceHidden(true),
      onDone: () => {
        setFlight(null);
        setEntering(null);
      },
    },
    dispatch,
    composerKey: (draftKey: string) => (draftKey === chat ? 'new' : draftKey),
    /** Captures the draft where it appears as its send starts (`captureComposerContent`). */
    depart: (content: ComposerContent | null) => {
      setSourceHidden(false);
      setFlight(content && { content, outcome: 'sending' });
    },
    waitPhase: waitPhase(sendingNewChat, followed ? taskId : null, detail),
  };
}
