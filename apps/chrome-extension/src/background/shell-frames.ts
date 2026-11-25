import {
  CHANNEL_REJECTION_CODES,
  type ChannelRejectionCode,
  type ShellFrame,
  type ShellFrameOf,
} from '../channel/protocol.ts';
import type { BackgroundToContent } from '../messages/content.ts';
import type { AskFailure } from '../messages/views.ts';
import type { CdpTranslator } from './cdp/translator.ts';
import type { FollowUps } from './follow-ups.ts';
import type { HiddenRuns } from './hidden-runs.ts';
import type { NativeChannel } from './native.ts';
import type { Ownership } from './ownership.ts';
import type { Pairing } from './pairing.ts';
import type { Pointers } from './pointer.ts';
import type { PendingRequests } from './requests.ts';
import type { RunLinks } from './run-links.ts';
import { persistPrefs, type Store } from './store.ts';

export interface ShellFrameDeps {
  store: Store;
  channel: NativeChannel;
  pairing: Pairing;
  ownership: Ownership;
  pointers: Pointers;
  translator: CdpTranslator;
  requests: PendingRequests;
  links: RunLinks;
  hidden: HiddenRuns;
  followUps: FollowUps;
}

/** Routes one validated shell frame (K2) to the module that owns its concern. */
export function handleShellFrame(deps: ShellFrameDeps, frame: ShellFrame): void {
  switch (frame.t) {
    case 'welcome':
      welcome(deps, frame);
      return;
    case 'pair.state':
      deps.pairing.onState(frame);
      return;
    case 'unpaired':
      deps.pairing.onUnpaired();
      return;
    case 'prefs': {
      const prefs = { language: frame.language, glowEffects: frame.glowEffects };
      deps.store.update({ prefs });
      persistPrefs(prefs);
      return;
    }
    case 'sites':
      deps.store.update({ sites: frame.origins });
      return;
    case 'runs':
      deps.store.update({ runs: frame.runs });
      deps.links.applyRuns(frame.runs);
      deps.hidden.applyRuns(frame.runs);
      void deps.ownership.applyRuns(frame.runs);
      return;
    case 'pointer':
      deps.pointers.apply(frame);
      return;
    case 'tab.hand':
      if (handAllowed(deps, frame.runId, frame.tabId))
        void deps.ownership.hand(frame.runId, frame.tabId);
      else
        console.warn(
          `[atd] refused to hand tab ${frame.tabId}: no ask of this tab started the run`,
        );
      return;
    case 'tab.open':
      void deps.ownership.open(frame.requestId, frame.runId, frame.url);
      return;
    case 'cdp.open':
      deps.translator.open(frame.conn);
      return;
    case 'cdp.close':
      deps.translator.close(frame.conn);
      return;
    case 'cdp':
      deps.translator.message(frame.conn, frame.msg);
      return;
    case 'ask.accepted': {
      const status: BackgroundToContent = {
        type: 'ask.status',
        requestId: frame.requestId,
        state: 'accepted',
        taskId: frame.taskId,
        runId: frame.runId,
      };
      const ask = deps.requests.deliver(frame.requestId, status);
      if (ask !== undefined) deps.links.accepted(frame.runId, ask.tabId, ask.withPage);
      return;
    }
    case 'ask.failed': {
      const status: BackgroundToContent = {
        type: 'ask.status',
        requestId: frame.requestId,
        state: 'failed',
        reason: askFailure(frame.reason),
      };
      deps.requests.deliver(frame.requestId, status);
      return;
    }
    case 'error': {
      // An error about a request or a follow-up fails it in its tab; an unreferenced channel
      // rejection halts reconnects so the popup can explain why; any other is only logged.
      const { ref } = frame;
      if (ref !== undefined && (deps.requests.fail(ref, 'failed') || deps.followUps.refused(ref)))
        return;
      console.warn(`[atd] Atd reported "${frame.code}"`, frame.message);
      if (ref === undefined) {
        const rejection = channelRejection(frame.code);
        if (rejection !== undefined) {
          deps.channel.halt(rejection === 'originMismatch' ? 'hostMissing' : rejection);
        }
      }
      return;
    }
  }
}

/** `welcome`: the shell's answer to `hello`. The channel is usable once `hostState` is `ready`. */
function welcome(deps: ShellFrameDeps, frame: ShellFrameOf<'welcome'>): void {
  deps.channel.resetBackoff();
  persistPrefs(frame.prefs);
  const browser = frame.browser?.trim() || undefined;
  deps.store.update({
    connection: frame.hostState,
    browser,
    prefs: frame.prefs,
    sites: frame.sites,
  });
  deps.pairing.onWelcome(frame.paired, frame.label);
}

/**
 * `tab.hand` is honored only for the tab an ask with its page came from: the ask Atd accepted for
 * this run, or one still waiting for its answer (the run is then tied to the tab here).
 */
function handAllowed(deps: ShellFrameDeps, runId: string, tabId: number): boolean {
  if (deps.links.mayHand(runId, tabId)) return true;
  if (!deps.requests.awaitsAskWithPage(tabId)) return false;
  deps.links.accepted(runId, tabId, true);
  return true;
}

/** The shell's `ask.failed` code as the HUD knows it; any other code reads as `failed`. */
function askFailure(reason: string): AskFailure {
  return reason === 'otherHost' || reason === 'serviceUnavailable' ? reason : 'failed';
}

/** Whether an unreferenced `error` frame carries a canonical shell rejection code. */
function channelRejection(code: string): ChannelRejectionCode | undefined {
  return CHANNEL_REJECTION_CODES.find((known) => known === code);
}
