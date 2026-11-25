import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { RunView } from '../channel/payloads.ts';
import { MAX_REQUEST_TEXT, type ContentMessage } from '../messages/content.ts';
import { ENDED_RUN_STATUSES, type AskFailure } from '../messages/views.ts';
import type { CommandList } from './commands.ts';
import type { FocusState } from './focus.ts';
import type { FollowUps } from './follow-ups.ts';
import type { HiddenRuns } from './hidden-runs.ts';
import { clipText, type SendFrame } from './native.ts';
import type { Ownership } from './ownership.ts';
import { failure, type PendingRequests } from './requests.ts';
import type { Store } from './store.ts';
import type { ContentIntent, Surfaces } from './surfaces.ts';

export interface ContentIntentDeps {
  store: Store;
  /** `send` for frames that need Atd: dropped while the channel is not ready. */
  forward: SendFrame;
  /** `send` for frames the shell handles itself: also while its service is unavailable. */
  toShell: SendFrame;
  surfaces: Surfaces;
  requests: PendingRequests;
  ownership: Ownership;
  commands: CommandList;
  focus: FocusState;
  followUps: FollowUps;
  hidden: HiddenRuns;
  /** The run the tab's HUD shows (`shownRun` in projection.ts), the only run it may act on. */
  shownRun(tabId: number): RunView | null;
}

/** An `ask` or `command.run` that failed validation but still names its request. */
const NamedRequestSchema = Type.Object({
  type: Type.Union([Type.Literal('ask'), Type.Literal('command.run')]),
  requestId: Type.String(),
});

/**
 * What a tab's HUD and selection bar ask for. The tab comes from the port's sender, never from
 * the message: the background adds the tab's id, URL and title to what it forwards. A run is
 * acted on only from a tab that shows it (a compromised renderer cannot reach another task).
 * Intents that need Atd are dropped while the channel is not ready; requests that expect an
 * answer are failed in the tab instead, so its UI does not wait for nothing.
 */
export function handleContentIntent(
  deps: ContentIntentDeps,
  tabId: number,
  intent: ContentIntent,
): void {
  switch (intent.type) {
    case 'ask':
    case 'command.run':
      void sendRequest(deps, tabId, intent);
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
      });
      return;
    case 'request.answer': {
      const run = shows(deps, tabId, intent.taskId, undefined);
      if (run === undefined) return;
      if (!run.requests.some((request) => request.requestId === intent.requestId)) {
        console.warn(`[atd] ignored an answer to a request tab ${tabId} does not show`);
        return;
      }
      deps.forward({
        t: 'request.answer',
        taskId: intent.taskId,
        requestId: intent.requestId,
        revision: intent.revision,
        answer: intent.answer,
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
    case 'commands.refresh':
      deps.commands.refreshIfStale();
      return;
    case 'focus':
      deps.focus.noteFrame(tabId, intent.inFrame);
      return;
  }
}

/**
 * A content message that failed validation. When it is an `ask` or `command.run` that names its
 * request, the request fails in the tab (`tooLong` when its text is over the cap), so its UI does
 * not wait for an answer; anything else is dropped.
 */
export function handleInvalidContent(
  deps: ContentIntentDeps,
  tabId: number,
  message: unknown,
): void {
  if (!Value.Check(NamedRequestSchema, message)) {
    console.warn('[atd] dropped an invalid content message');
    return;
  }
  const kind = message.type === 'ask' ? 'ask' : 'command';
  const texts = kind === 'ask' ? ['text', 'selection'] : ['selection'];
  const tooLong = texts.some((key) => overCap(Reflect.get(message, key)));
  console.warn(`[atd] refused an invalid ${message.type} request`);
  deps.surfaces.postToTab(tabId, failure(message.requestId, kind, tooLong ? 'tooLong' : 'failed'));
}

type RequestIntent = Extract<ContentMessage, { type: 'ask' | 'command.run' }>;

/** `ask` or `command.run`, with the tab's page; the answer is routed back by request id. */
async function sendRequest(
  deps: ContentIntentDeps,
  tabId: number,
  intent: RequestIntent,
): Promise<void> {
  const kind = intent.type === 'ask' ? 'ask' : 'command';
  const refuse = (reason: AskFailure): void => {
    deps.surfaces.postToTab(tabId, failure(intent.requestId, kind, reason));
  };
  const early = refusal(deps.store);
  if (early !== undefined) {
    refuse(early);
    return;
  }
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  // The channel may have closed or the pairing ended while the tab was read.
  const late = refusal(deps.store);
  if (late !== undefined) {
    refuse(late);
    return;
  }
  const withPage = intent.type === 'command.run' || intent.includePage;
  deps.requests.remember(intent.requestId, tabId, kind, withPage);
  const page = { url: clipText(tab?.url), title: clipText(tab?.title) };
  const sent =
    intent.type === 'ask'
      ? deps.forward({
          t: 'ask',
          requestId: intent.requestId,
          tabId,
          // The person removed the page from the request: Atd gets neither its URL nor its title.
          ...(intent.includePage ? page : { url: '', title: '' }),
          text: intent.text,
          ...(intent.selection === undefined ? {} : { selection: intent.selection }),
        })
      : deps.forward({
          t: 'command.run',
          requestId: intent.requestId,
          tabId,
          ...page,
          selection: intent.selection,
          command: intent.command,
        });
  if (!sent) deps.requests.fail(intent.requestId, 'notConnected');
}

function refusal(store: Store): AskFailure | undefined {
  if (store.state.connection !== 'ready') return 'notConnected';
  if (store.state.pairing.state !== 'paired') return 'notPaired';
  return undefined;
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
