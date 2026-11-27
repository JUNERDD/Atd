import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { RunView } from '../channel/payloads.ts';
import { MAX_REQUEST_TEXT } from '../messages/content.ts';
import { ENDED_RUN_STATUSES } from '../messages/views.ts';
import { openPanel } from './action-surface.ts';
import { sendAsk } from './asks.ts';
import type { FollowUps } from './follow-ups.ts';
import type { HiddenRuns } from './hidden-runs.ts';
import type { SendFrame } from './native.ts';
import type { Ownership } from './ownership.ts';
import { failure, type PendingRequests } from './requests.ts';
import type { Store } from './store.ts';
import type { ContentIntent, ContentReply, Surfaces } from './surfaces.ts';

export interface ContentIntentDeps {
  store: Store;
  /** `send` for frames that need Atd: dropped while the channel is not ready. */
  forward: SendFrame;
  /** `send` for frames the shell handles itself: also while its service is unavailable. */
  toShell: SendFrame;
  surfaces: Surfaces;
  requests: PendingRequests;
  ownership: Ownership;
  followUps: FollowUps;
  hidden: HiddenRuns;
  /** The run the tab's HUD shows (`shownRun` in projection.ts), the only run it may act on. */
  shownRun(tabId: number): RunView | null;
}

/** An `ask` that failed validation but still names its request. */
const NamedAskSchema = Type.Object({ type: Type.Literal('ask'), requestId: Type.String() });

/**
 * What a tab's HUD asks for. The tab comes from the port's sender, never from the message: the
 * background adds the tab's id, URL and title to what it forwards. A run is acted on only from a
 * tab that shows it (a compromised renderer cannot reach another task).
 * Intents that need Atd are dropped while the channel is not ready; requests that expect an
 * answer are failed in the tab instead, so its UI does not wait for nothing.
 */
export function handleContentIntent(
  deps: ContentIntentDeps,
  tabId: number,
  intent: ContentIntent,
  reply: ContentReply,
): void {
  switch (intent.type) {
    case 'ask': {
      const { requestId, text, includePage, taskId, elements, ownInput } = intent;
      // A tab replies only to the conversation its HUD shows.
      if (taskId !== undefined && shows(deps, tabId, taskId, undefined) === undefined) {
        deps.surfaces.postToTab(tabId, failure(requestId, 'failed'));
        return;
      }
      const ask = {
        from: 'tab',
        tabId,
        requestId,
        text,
        includePage,
        ...(taskId === undefined ? {} : { taskId }),
        ...(elements === undefined ? {} : { elements }),
        ...(ownInput === undefined ? {} : { ownInput }),
      } as const;
      // Answered in the tab's current document: one restored from the back/forward cache
      // reconnects on a new port, and any other ignores a request id it did not send.
      void sendAsk(deps, ask, (status) => deps.surfaces.postToTab(tabId, status));
      return;
    }
    case 'panel.open':
      // Synchronously, while this message's dispatch still carries the person's click.
      void openPanel({ tabId }).then((opened) => reply({ type: 'panel.status', opened }));
      return;
    case 'run.stop':
      if (shows(deps, tabId, intent.taskId, intent.runId) !== undefined)
        deps.forward({ t: 'run.stop', taskId: intent.taskId, runId: intent.runId });
      return;
    case 'run.dismiss':
    case 'run.hide': {
      const run = shows(deps, tabId, intent.taskId, intent.runId);
      if (run === undefined || !ENDED_RUN_STATUSES.includes(run.status)) return;
      // Only the person's Dismiss lets the shell forget the run; either keeps it out of this tab.
      if (intent.type === 'run.dismiss')
        deps.forward({ t: 'run.dismiss', taskId: intent.taskId, runId: intent.runId });
      deps.hidden.hide(intent.runId, tabId);
      return;
    }
    case 'run.hold':
      if (shows(deps, tabId, intent.taskId, intent.runId) === undefined) return;
      deps.forward({
        t: 'run.hold',
        taskId: intent.taskId,
        runId: intent.runId,
        tabId,
        held: intent.held,
        ...(!intent.held && intent.ownInput !== undefined ? { ownInput: intent.ownInput } : {}),
      });
      return;
    case 'request.answer': {
      const run = shows(deps, tabId, intent.taskId, undefined);
      if (run === undefined) return;
      const shown = run.requests.find((request) => request.requestId === intent.requestId);
      if (shown === undefined) {
        console.warn(`[atd] ignored an answer to a request tab ${tabId} does not show`);
        return;
      }
      deps.forward({
        t: 'request.answer',
        taskId: intent.taskId,
        requestId: intent.requestId,
        revision: intent.revision,
        answer: intent.answer,
        ...(shown.revision === intent.revision && intent.ownInput !== undefined
          ? { ownInput: intent.ownInput }
          : {}),
      });
      return;
    }
    case 'run.followUp':
      if (shows(deps, tabId, intent.taskId, undefined) === undefined) return;
      if (deps.forward({ t: 'run.followUp', taskId: intent.taskId, kind: intent.kind }))
        deps.followUps.sent(intent.taskId);
      else deps.followUps.dropped(intent.taskId);
      return;
    case 'app.open':
      deps.toShell({
        t: 'app.open',
        ...(intent.taskId === undefined ? {} : { taskId: intent.taskId }),
      });
      return;
    case 'input':
      deps.ownership.noteInput(tabId);
      return;
  }
}

/**
 * A content message that failed validation. When it is an `ask` that names its request, the
 * request fails in the tab (`tooLong` when its text is over the cap), so its UI does not wait for
 * an answer; anything else is dropped.
 */
export function handleInvalidContent(
  deps: ContentIntentDeps,
  tabId: number,
  message: unknown,
): void {
  if (!Value.Check(NamedAskSchema, message)) {
    console.warn('[atd] dropped an invalid content message');
    return;
  }
  const tooLong = overCap(Reflect.get(message, 'text'));
  console.warn('[atd] refused an invalid ask');
  deps.surfaces.postToTab(tabId, failure(message.requestId, tooLong ? 'tooLong' : 'failed'));
}

/** The run the tab shows when it is the one named (`runId` too when given), else undefined. */
function shows(
  deps: ContentIntentDeps,
  tabId: number,
  taskId: string,
  runId: string | undefined,
): RunView | undefined {
  const run = deps.shownRun(tabId);
  if (run !== null && run.taskId === taskId && (runId === undefined || run.runId === runId))
    return run;
  console.warn(`[atd] ignored a request for a run tab ${tabId} does not show`);
  return undefined;
}

/** Whether `value` is a string longer than the cap in code points (as TypeBox counts). */
function overCap(value: unknown): boolean {
  if (typeof value !== 'string' || value.length <= MAX_REQUEST_TEXT) return false;
  let points = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    // A high surrogate followed by a low one is a single code point.
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
    }
    points += 1;
    if (points > MAX_REQUEST_TEXT) return true;
  }
  return false;
}
