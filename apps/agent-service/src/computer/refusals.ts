import type {
  ActionResult,
  ComputerDisturbance,
  ComputerError,
  ComputerErrorCode,
  ComputerRefusalReason,
} from '@atd/agent-contracts';

/*
 * What the model is told after the host refused, ended or repaired a step
 * (docs/plans/2026-10-19-imperceptible-computer-use.md §3, §6;
 * docs/plans/2026-10-21-foreground-fallback.md R3, R7, R10). Where the request allows it, the host
 * already completes a step in the foreground when no background route can, so a refusal is a limit
 * that nothing the task may use lifts: the agent hands that one step to the person, waits for them,
 * or stops. The computer-use skill teaches the same rules; this text travels with each answer, so
 * a model that did not load the skill still acts on it.
 */

/**
 * One limit as the model reads it: what stopped the step (`limit`), what to ask of the person
 * (`ask`, absent: to do the step themselves) and how to go on once they did (`resume`, absent:
 * observe again and continue). A limit the person does not lift by doing the step gives the whole
 * hand-over instead (`next`).
 */
type Limit = { limit: string; ask?: string; resume?: string } | { limit: string; next: string };

/**
 * The hand-over of a key or text step, which the host also refuses with its background reason when
 * the person's input method would turn the keys into text of its own (its message names the
 * method): with a plain layout selected Atd can type, so the step goes again only after a switch.
 */
const TYPING: { ask: string; resume: string } = {
  ask: 'ask the person to do just this step themselves, saying exactly what it is; if the message names an input method, ask them instead to switch to a keyboard layout such as ABC so Atd can type, or to do the step themselves',
  resume:
    'observe again and continue, sending the step in a new act with actionId omitted only once they say they switched',
};

const LIMITS: Readonly<Record<ComputerRefusalReason, Limit>> = {
  dragAndDrop: {
    limit:
      "it needs a native drag and drop with the real pointer, such as between windows or apps, and Atd never moves the person's pointer",
  },
  hover: {
    limit:
      "it needs the real pointer to hover, such as for a hover menu or a tooltip, and Atd never moves the person's pointer",
  },
  opaqueSurface: {
    limit:
      'the app draws this area without accessibility elements, such as a canvas, video or game, and input Atd posts there misses in the foreground too',
  },
  pointerToolkit: {
    limit:
      "the app follows only the real pointer, so input sent to its window would miss even in the foreground, and Atd never moves the person's pointer",
  },
  secureInput: {
    limit: "secure text entry is on, which takes only the person's own typing",
    ask: 'ask the person to type it themselves (never ask them for the secret)',
  },
  menuUnavailable: {
    limit: 'that menu item is missing or cannot be chosen while the app stays in the background',
  },
  textUnavailable: { limit: 'no background route can write this text here', ...TYPING },
  keyUnavailable: { limit: 'no background route can send this key or shortcut here', ...TYPING },
  minimized: {
    limit: 'the window is minimized, and Atd never restores a window',
    ask: 'ask the person to restore the window',
  },
  offSpace: {
    limit:
      'the window is not on the Space the person is using, or Atd cannot tell whether it is, and Atd never moves a window or switches Spaces to reach it',
    ask: 'ask the person to bring the window onto the desktop they are using',
  },
  fullScreen: {
    limit: 'the window is in a full-screen Space, which Atd never switches to',
    ask: 'ask the person to take the window out of full screen',
  },
  noRoute: { limit: 'no route Atd may use here reaches this step on this target' },
  openBrowser: {
    limit:
      "the site's browser environment could not be started in the background (access stays approved)",
    ask: 'ask the person to open it with the Open browser button in the conversation or from Settings → Computer use',
    resume: 'call requestAccess again',
  },
  screenLocked: {
    limit: 'the Mac is locked, and macOS hides app windows and drops input to them while it is',
    next: 'tell the person that work in this app continues once they unlock the Mac, without asking them to do this step themselves; browser targets can continue meanwhile, and once they are back, observe again and continue',
  },
  covered: {
    limit:
      "Atd brought the app forward to do it in the foreground, but another window, possibly Atd's own panel, still covered the spot the step acts on, so Atd sent nothing and put back what the person had in front of them",
    ask: 'ask the person to move that window out of the way or to do just this step themselves, saying exactly what it is',
    resume:
      'observe again and continue, sending the step in a new act with actionId omitted only if they moved the window rather than doing the step',
  },
  notActivated: {
    limit:
      'Atd tried to bring the app and its window to the front to do it in the foreground, but macOS did not let it, so Atd sent nothing and put back what it had changed',
  },
};

/** The default hand-over: the person does the step (or what `ask` says), then the agent goes on. */
function handOver(ask: string | undefined, resume: string | undefined): string {
  const request =
    ask ?? 'ask the person to do just this step themselves, saying exactly what it is';
  return `${request}, wait until they say it is done, then ${resume ?? 'observe again and continue'}`;
}

function noRouteGuidance(reason: ComputerRefusalReason | undefined): string {
  const entry = LIMITS[reason ?? 'noRoute'];
  const next = 'next' in entry ? entry.next : handOver(entry.ask, entry.resume);
  return `This step has no background route: ${entry.limit}. Atd already tried every way this task allows, including the foreground where it may use it, and no call can ask for another, so do not retry it or work around it with other tools: ${next}.`;
}

/** What to do after the other errors a refusal or the host's guard causes. */
const GUIDANCE: Readonly<Partial<Record<ComputerErrorCode, string>>> = {
  targetInUse:
    'The person is working in this target right now (it is in front of them and they typed, clicked or scrolled in the last few seconds), so Atd yielded and sent nothing. Never ask them to stop. Wait a few seconds (observe with afterMs), then try again; if it stays in use, tell them you will continue once they are done with it, and stop for now.',
  inputInUse:
    'The person is using the keyboard or pointer right now (typing, clicking or scrolling in any app), so Atd held the step back rather than send input while they do, or stopped a step it was doing in the foreground as soon as they started and put back what they had in front of them; with effect none, nothing was sent. This passes in a moment: never ask them to stop, and never ask them to do the step themselves. Wait a few seconds (observe with afterMs), then try it again; if it keeps happening, tell them you will continue once they pause, and stop for now. If effect is not none, part of the step went out before they started: read effect and retry as for any uncertain result.',
  needsConsent:
    'Screen capture was never prepared for Atd, and a run never asks for it while working. Continue without screenshots if the accessibility tree is enough; otherwise tell the person to prepare screen access once in Settings → Computer use.',
  disturbed:
    "This action changed something of the person's (disturbances lists what, who caused it and whether it was repaired); Atd repaired what it could and ended the action. When a background route caused it, Atd keeps that route off on that app until the person replies (until Atd restarts once it has disturbed them twice); a step done in the foreground switches no route off. Stop acting on this target, tell the person what was disturbed and anything not repaired, and continue only when they ask you to. Read effect and retry as for any uncertain result.",
};

/**
 * What to do after an error a refusal or the host's guard caused, or null for any other error:
 * `noBackgroundRoute` hands the step to the person, `targetInUse` waits for them, `inputInUse`
 * waits a moment and tries again, `needsConsent` needs screen capture prepared in Settings, and
 * `disturbed` stops work on the target.
 */
export function refusalGuidance(error: Pick<ComputerError, 'code' | 'reason'>): string | null {
  if (error.code === 'noBackgroundRoute') return noRouteGuidance(error.reason);
  return GUIDANCE[error.code] ?? null;
}

/** A host refusal as the model reads it: the code, its reason, the host's words and what to do. */
export function refusalText(error: ComputerError): string {
  const code = error.reason ? `${error.code} (${error.reason})` : error.code;
  const guidance = refusalGuidance(error);
  return `The computer host refused: ${code}: ${error.message}${guidance ? ` ${guidance}` : ''}`;
}

/**
 * Disturbances the host undoes by restoring the person's front app and key window. It never moves
 * the pointer (R13), so a pointer disturbance is never one of them.
 */
const RESTORED_KINDS: ReadonlySet<ComputerDisturbance['kind']> = new Set(['raise', 'activation']);

/**
 * What to do after an action that ended without an error although a background route raised a
 * window over the person's or activated the app, which the host then repaired by restoring the app
 * and window they had, or null when the result lists no such disturbance (R7). The host only goes
 * on this way in a request that allows the foreground (foreground.ts), so the caller asks only
 * then: that route is off for the rest of the run, later steps that need it run in the foreground,
 * and the task goes on instead of stopping for the person.
 */
export function restoredGuidance(result: ActionResult): string | null {
  if (result.error) return null;
  const restored = result.disturbances?.some(
    (item) => item.attribution === 'agent' && item.repaired && RESTORED_KINDS.has(item.kind),
  );
  return restored
    ? 'A background route disturbed the person during this action (disturbances lists it: a window raised over theirs or an app made active). Atd put back the app and window they had and switched that route off for this kind of step in this app, so a later step that needs it runs in the foreground. The action was not stopped and this needs nothing from the person: read the result as usual and continue the task.'
    : null;
}
