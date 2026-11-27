import type { OwnInput, PickedElement } from '../channel/payloads.ts';
import { canReply, type AskFailure } from '../messages/views.ts';
import { clipText, type SendFrame } from './native.ts';
import { failure, type AskAnswer, type PendingRequests } from './requests.ts';
import type { Store } from './store.ts';
import { webOrigin } from './urls.ts';

export interface AskDeps {
  store: Store;
  /** `send` for frames that need Atd: dropped while the channel is not ready. */
  forward: SendFrame;
  requests: PendingRequests;
}

/**
 * A request the person sent to Atd. `tab`: a tab's in-page ask, whose page is the tab's own
 * document, with the elements the person picked on it (`elements`). `panel`: the panel's composer,
 * sent from the tab its window shows; its page goes along only while that tab still shows a
 * website, the only page the panel offers to include. `taskId`: the conversation it replies to.
 */
export interface Ask {
  from: 'tab' | 'panel';
  requestId: string;
  tabId: number;
  text: string;
  includePage: boolean;
  taskId?: string;
  elements?: readonly PickedElement[];
  ownInput?: OwnInput;
}

/**
 * Sends `ask` to Atd, with the tab's page unless the person left it out, and the elements picked
 * on it only together with it; Atd's answer (or the background's refusal) reaches `answer` by
 * request id. The tab's URL and title are read here, at the moment it is sent, never taken from
 * the surface. The person's input on Atd's own UI goes along only while they could have made it
 * there: the tab's window is focused (and, for an in-page ask, the tab is its active one).
 */
export async function sendAsk(deps: AskDeps, ask: Ask, answer: AskAnswer): Promise<void> {
  const refuse = (reason: AskFailure): void => answer(failure(ask.requestId, reason));
  const early = refusal(deps.store);
  if (early !== undefined) return refuse(early);
  // A reply goes only to a conversation whose latest turn the surfaces show as ended.
  if (ask.taskId !== undefined && !mayReply(deps.store, ask.taskId)) return refuse('failed');
  const tab = await chrome.tabs.get(ask.tabId).catch(() => undefined);
  // The panel asked from a tab that has closed since: what it showed is gone.
  if (tab === undefined && ask.from === 'panel') return refuse('failed');
  const inFront = ask.from === 'panel' || tab?.active === true;
  const win =
    ask.ownInput !== undefined && inFront && tab?.windowId !== undefined
      ? await chrome.windows.get(tab.windowId).catch(() => undefined)
      : undefined;
  // The channel may have closed or the pairing ended while the tab was read.
  const late = refusal(deps.store);
  if (late !== undefined) return refuse(late);
  const withPage =
    ask.includePage && (ask.from === 'tab' || webOrigin(tab?.url ?? '') !== undefined);
  // Without its page, Atd gets neither the tab's URL nor its title.
  const url = withPage ? clipText(tab?.url) : '';
  // Elements are part of the page: without it they are dropped, and an empty list is left out.
  const elements = url !== '' && ask.elements !== undefined ? [...ask.elements] : [];
  deps.requests.remember(ask.requestId, { tabId: ask.tabId, withPage, answer });
  const sent = deps.forward({
    t: 'ask',
    requestId: ask.requestId,
    tabId: ask.tabId,
    url,
    title: withPage ? clipText(tab?.title) : '',
    text: ask.text,
    ...(ask.taskId === undefined ? {} : { taskId: ask.taskId }),
    ...(elements.length > 0 ? { elements } : {}),
    ...(win?.focused === true && ask.ownInput !== undefined ? { ownInput: ask.ownInput } : {}),
  });
  if (!sent) deps.requests.fail(ask.requestId, 'notConnected');
}

/** The shell lists runs live first, newest first: a task's first run there is its latest turn. */
function mayReply(store: Store, taskId: string): boolean {
  const latest = store.state.runs.find((run) => run.taskId === taskId);
  return latest !== undefined && canReply(latest);
}

function refusal(store: Store): AskFailure | undefined {
  if (store.state.connection !== 'ready') return 'notConnected';
  if (store.state.pairing.state !== 'paired') return 'notPaired';
  return undefined;
}
