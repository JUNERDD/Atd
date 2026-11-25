import type { RunView } from '../channel/payloads.ts';
import {
  ACTIVE_RUN_STATUSES,
  ENDED_RUN_STATUSES,
  type PopupView,
  type SiteView,
  type TabView,
} from '../messages/views.ts';
import { effectivePrefs, type BackgroundState } from './store.ts';
import { webOrigin } from './urls.ts';

/**
 * The views the surfaces render (`messages/views.ts`), derived from the background state. Pure,
 * so every push of the same state produces the same view.
 */

export function isActiveStatus(status: RunView['status']): boolean {
  return ACTIVE_RUN_STATUSES.includes(status);
}

/** A run the person must act on: an approval, a sign-in, or their own hold (Take over). */
export function needsPerson(status: RunView['status']): boolean {
  return status === 'attention' || status === 'held';
}

/**
 * The runs as the surfaces show them. While the channel is not ready an active run becomes
 * `disconnected`: its last known state, never claiming progress the worker cannot see.
 */
export function projectRuns(state: BackgroundState): RunView[] {
  if (state.connection === 'ready') return [...state.runs];
  return state.runs.map((run): RunView =>
    isActiveStatus(run.status) ? { ...run, status: 'disconnected' } : run,
  );
}

export function popupView(state: BackgroundState, fallbackBrowser: string): PopupView {
  return {
    connection: state.connection,
    pairing: state.pairing,
    profileLabel: state.browser || fallbackBrowser,
    prefs: effectivePrefs(state.prefs),
    runs: projectRuns(state),
    sites: [...state.sites],
    askShortcut: state.askShortcut,
  };
}

/** What this worker knows of a tab's runs beyond the shell's `runs` (see `runForTab`). */
export interface TabRuns {
  /** Runs it tied to the tab: the one owning it, and runs asked from it without its page. */
  linked: readonly string[];
  /** Ended runs whose HUD left the tab (`HiddenRuns`). */
  hidden: ReadonlySet<string>;
}

/**
 * The run a tab shows: among the runs that list the tab or that this worker tied to it, the first
 * active one, else the first. The shell sends runs newest first, so that is the latest. An ended
 * run whose HUD already left the tab shows nothing rather than an older run.
 */
export function runForTab(
  runs: readonly RunView[],
  tabId: number,
  tabRuns: TabRuns,
): RunView | null {
  const mine = runs.filter((run) => run.tabs.includes(tabId) || tabRuns.linked.includes(run.runId));
  const run = mine.find((candidate) => isActiveStatus(candidate.status)) ?? mine[0] ?? null;
  if (run === null) return null;
  return ENDED_RUN_STATUSES.includes(run.status) && tabRuns.hidden.has(run.runId) ? null : run;
}

/** The run the tab's HUD shows (`runForTab` over the runs as the surfaces see them). */
export function shownRun(state: BackgroundState, tabId: number, tabRuns: TabRuns): RunView | null {
  return runForTab(projectRuns(state), tabId, tabRuns);
}

/** One tab's view; `tabRuns` as for `runForTab`. */
export function tabView(
  state: BackgroundState,
  tabId: number,
  url: string,
  tabRuns: TabRuns,
): TabView {
  const runs = projectRuns(state);
  return {
    tabId,
    connection: state.connection,
    paired: state.pairing.state === 'paired',
    prefs: effectivePrefs(state.prefs),
    run: runForTab(runs, tabId, tabRuns),
    busy: runs.some((run) => isActiveStatus(run.status)),
    commands: [...state.commands],
    site: siteView(url, state.sites),
  };
}

/** The tab's site when it is an http(s) page (the only pages a site binding can cover). */
export function siteView(url: string, sites: readonly string[]): SiteView | null {
  const origin = webOrigin(url);
  if (origin === undefined) return null;
  return { origin: origin.origin, host: origin.host, allowed: sites.includes(origin.origin) };
}
