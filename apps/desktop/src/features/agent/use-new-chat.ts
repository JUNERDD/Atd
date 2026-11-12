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
 * welcome dissolves into the whole conversation on one timeline. A message or launched command
 * opens its conversation in the render that sends it, before the service creates the task
 * (`unsaved`); when a command run creates its task under a service-picked id, the chat follows it.
 *
 * - `welcome`: the welcome stays visible but inert while a command's send is out (`pending`), then
 *   stays mounted through the shared dissolve into the conversation it opened (`toChat`).
 * - `stage`: the conversation's first turn is arriving (`data-entering`) until its fade has run.
 * - `flight` and `dispatch`: the sent message on its way, and the composer under it, until the
 *   message has landed.
 * - `composerKey`: the composer that sent the chat goes on serving the conversation it opened, so
 *   neither its editor nor its change of shape restarts when the page changes.
 * - `waitPhase`: the waiting light's phase, which follows the chat through its first run, from
 *   the first message on its way.
 *
 * A command's result and its end land in one render (`sendSettling` calls both in one task), so
 * the render where `sending` turns false already shows the task it opened.
 */
export function useNewChat({
  sending,
  unsaved,
  view,
  taskId,
  detail,
  covered,
}: {
  /** The panel's send is in flight. */
  sending: boolean;
  /** The page shows a new chat whose first message the service has not taken (`usePageDetail`). */
  unsaved: boolean;
  view: PanelView;
  /** The conversation the panel shows. */
  taskId: string | null;
  /** The latest loaded detail, which may still be another task's. */
  detail: TaskDetail | null;
  /** A drill-in or a side chat covers the conversation. */
  covered: boolean;
}) {
  const [sendingNewChat, setSendingNewChat] = useState(false);
  /** The unsaved chat whose first run is in flight; its server id may differ once accepted. */
  const [unsavedChat, setUnsavedChat] = useState<string | null>(null);
  /** The task the latest new chat opened. */
  const [chat, setChat] = useState<string | null>(null);
  /** The latest new chat whose first output has already appeared. */
  const [responded, setResponded] = useState<string | null>(null);
  /** The task the latest new chat opened, while its first turn arrives. */
  const [entering, setEntering] = useState<string | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [sourceHidden, setSourceHidden] = useState(false);
  if (sending && view === 'new' && !sendingNewChat) setSendingNewChat(true);
  // A message or launched command opens its new chat as it is sent, before the service creates it.
  const opening = unsaved && view === 'task' ? taskId : null;
  if (opening !== null && opening !== chat) {
    setChat(opening);
    setEntering(opening);
    if (flight) setFlight({ ...flight, outcome: 'opened' });
  }
  if (opening !== null && sending && unsavedChat !== opening) setUnsavedChat(opening);
  if (unsavedChat !== null && !unsaved) {
    setUnsavedChat(null);
    if (!sending && view === 'task' && taskId !== null && chat === unsavedChat && taskId !== chat) {
      setChat(taskId);
      if (entering === unsavedChat) setEntering(taskId);
    }
  }
  if (sendingNewChat && !sending) {
    const opened = view === 'task' ? taskId : null;
    setSendingNewChat(false);
    setChat(opened);
    setEntering(opened);
    if (flight) setFlight(opened === null ? null : { ...flight, outcome: 'opened' });
  } else if (flight?.outcome === 'sending' && !sendingNewChat && !sending) {
    // The panel refused the send before it started, so the draft never left the composer.
    setFlight(null);
  }
  if (entering !== null && (view !== 'task' || taskId !== entering)) setEntering(null);
  // Leaving the conversation mid-flight leaves nowhere to land.
  if (flight?.outcome === 'opened' && (view !== 'task' || taskId !== chat)) setFlight(null);
  const followed = !covered && view === 'task' && taskId !== null && taskId === chat;
  const phase = waitPhase(
    sendingNewChat || (followed && unsaved && sending),
    followed ? taskId : null,
    detail,
  );
  // A live thought can disappear when it settles without text, before prose's first token.
  // That ends the row, not the first output's arrival: this chat's waiting light must stay out.
  if (phase === 'answering' && responded !== chat) setResponded(chat);
  const dispatch: ComposerDispatch | null = flight && {
    hidden: flight.outcome === 'sending',
    covered: !sourceHidden,
    from: flight.content.surface,
  };
  return {
    welcome: { pending: sendingNewChat, toChat: flight?.outcome === 'opened' && entering !== null },
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
    waitPhase: phase === 'waiting' && followed && responded === chat ? 'answering' : phase,
  };
}
