import type { ComputerError, ComputerErrorCode, ComputerRefusalReason } from '@atd/agent-contracts';

/*
 * What the model is told after the host refused or ended a step under the imperceptible contract
 * (docs/plans/2026-10-19-imperceptible-computer-use.md §3, §6). The host never takes the
 * foreground instead, so the agent hands that one step to the person, waits for them, or stops.
 * The computer-use skill teaches the same rules; this text travels with each refusal, so a model
 * that did not load the skill still acts on it.
 */

/**
 * One background limit as the model reads it: what stopped the step (`limit`), what to ask of the
 * person (`ask`, absent: to do the step themselves) and how to go on once they did (`resume`,
 * absent: observe again and continue). A limit the person does not lift by doing the step gives
 * the whole hand-over instead (`next`).
 */
type Limit = { limit: string; ask?: string; resume?: string } | { limit: string; next: string };

const LIMITS: Readonly<Record<ComputerRefusalReason, Limit>> = {
  dragAndDrop: {
    limit: 'it needs a native drag and drop, such as between windows or apps',
  },
  hover: { limit: 'it needs the pointer to hover, such as for a hover menu or a tooltip' },
  opaqueSurface: {
    limit:
      'the app draws this area without accessibility elements, such as a canvas, video or game',
  },
  pointerToolkit: {
    limit: 'the app reads the real pointer position, so input sent to its window would miss',
  },
  secureInput: {
    limit: "secure text entry is on, which takes only the person's own typing",
    ask: 'ask the person to type it themselves (never ask them for the secret)',
  },
  menuUnavailable: {
    limit: 'that menu item is missing or cannot be chosen while the app stays in the background',
  },
  textUnavailable: { limit: 'no background route can write this text here' },
  keyUnavailable: { limit: 'no background route can send this key or shortcut here' },
  minimized: {
    limit: 'the window is minimized, and Atd never restores a window',
    ask: 'ask the person to restore the window',
  },
  offSpace: {
    limit:
      'the step needs input routed to the window, which reaches only a window on the Space the person is using, and Atd never moves a window or switches Spaces',
    ask: 'ask the person to bring the window onto the desktop they are using',
  },
  fullScreen: {
    limit:
      'the step needs input routed to the window, which does not reach a window in a full-screen Space, and Atd never switches to it',
    ask: 'ask the person to take the window out of full screen',
  },
  noRoute: {
    limit: "no route reaches this step on this target without the person's pointer or keyboard",
  },
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
  return `This step has no background route: ${entry.limit}. Atd never takes the person's pointer, keyboard or screen instead, so do not retry it or work around it with other tools: ${next}.`;
}

/** What to do after the other errors the imperceptible contract causes. */
const GUIDANCE: Readonly<Partial<Record<ComputerErrorCode, string>>> = {
  targetInUse:
    'The person is working in this target right now (it is in front of them and they typed, clicked or scrolled in the last few seconds), so Atd yielded and sent nothing. Never ask them to stop. Wait a few seconds (observe with afterMs), then try again; if it stays in use, tell them you will continue once they are done with it, and stop for now.',
  needsConsent:
    'Screen capture was never prepared for Atd, and a run never asks for it while working. Continue without screenshots if the accessibility tree is enough; otherwise tell the person to prepare screen access once in Settings → Computer use.',
  disturbed:
    "This action changed something of the person's (disturbances lists what, who caused it and whether it was repaired); Atd repaired what it could and ended the action, and on an app it keeps the route the action took off until the person replies (until Atd restarts once that route has disturbed them twice). Stop acting on this target, tell the person what was disturbed and anything not repaired, and continue only when they ask you to. Read effect and retry as for any uncertain result.",
};

/**
 * What to do after an error the imperceptible contract caused, or null for any other error:
 * `noBackgroundRoute` hands the step to the person, `targetInUse` waits for them, `needsConsent`
 * needs screen capture prepared in Settings, and `disturbed` stops work on the target.
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
