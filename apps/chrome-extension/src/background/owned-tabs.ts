import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { RunView } from '../channel/payloads.ts';
import type { BackgroundDiagReporter } from '../diagnostics/recorder.ts';
import { isActiveStatus } from './projection.ts';

/**
 * Which tabs belong to which run (D9): the tab an ask handed its run, tabs the run opened, and
 * popups and tabs opened from its tabs. A `runs` snapshot never makes a tab owned, it only ends
 * ownership (a run that ended or left it). Only owned tabs of active runs are ever attached. The
 * map lives in `chrome.storage.session`, so a restarted service worker keeps it; Chrome clears
 * that storage when the browser quits, as it does the tab ids.
 */

/** How long a run handed a tab counts as active before the shell's snapshot lists it. */
const HAND_GRACE_MS = 30_000;
/**
 * How long after Atd dispatched input into a tab the page's activity is taken as its echo, not
 * the person's: the content script sees CDP input as trusted events and reports them too.
 */
const ATD_INPUT_ECHO_MS = 1_000;
const SESSION_KEY = 'atd.ownedTabs';

export interface OwnedTab {
  runId: string;
  /** When the run took the tab (ms since the epoch). */
  since: number;
  /** The tab's CDP target id once known: the `pageId` the worker and the pointer use. */
  targetId?: string;
  /** The person's last input in the tab (ms since the epoch), reported as `lastInputAt`. */
  lastInputAt?: number;
}

const StoredSchema = Type.Object({
  tabs: Type.Array(
    Type.Object({
      tabId: Type.Integer({ minimum: 0 }),
      runId: Type.String({ minLength: 1 }),
      since: Type.Number(),
      targetId: Type.Optional(Type.String({ minLength: 1 })),
    }),
  ),
  seenRuns: Type.Array(Type.String()),
  released: Type.Array(Type.String()),
});

export class OwnedTabs {
  private readonly tabs = new Map<number, OwnedTab>();
  /** Each run's status in the last snapshot. */
  private statuses = new Map<string, RunView['status']>();
  /** Runs some snapshot listed: once a run left the snapshot it is over, grace or not. */
  private readonly seenRuns = new Set<string>();
  /**
   * `runId:tabId` pairs the person released (closed, ungrouped, Cancel), so a late `tab.hand` for
   * the same run does not take the tab back; forgotten once the run leaves the snapshot.
   */
  private readonly released = new Set<string>();
  private readonly listeners = new Set<() => void>();
  /** When Atd last dispatched input into each tab (memory only). */
  private readonly atdInputAt = new Map<number, number>();
  private persistScheduled = false;

  async restore(onDiagnostic?: BackgroundDiagReporter): Promise<void> {
    const stored = await chrome.storage.session.get(SESSION_KEY);
    const value: unknown = stored[SESSION_KEY];
    if (!Value.Check(StoredSchema, value)) {
      if (value !== undefined) {
        onDiagnostic?.({
          level: 'warn',
          cat: 'storage',
          code: 'invalid_owned_tabs',
          msg: 'Ignored invalid stored owned-tabs state',
        });
      }
      return;
    }
    for (const { tabId, ...entry } of value.tabs) this.tabs.set(tabId, entry);
    for (const runId of value.seenRuns) this.seenRuns.add(runId);
    for (const pair of value.released) this.released.add(pair);
  }

  /** Called whenever a tab is taken or let go (not for input notes). */
  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  get(tabId: number): OwnedTab | undefined {
    return this.tabs.get(tabId);
  }

  ownedTabIds(): number[] {
    return [...this.tabs.keys()];
  }

  tabsOf(runId: string): number[] {
    return [...this.tabs].filter(([, entry]) => entry.runId === runId).map(([tabId]) => tabId);
  }

  tabWithTarget(targetId: string): number | undefined {
    for (const [tabId, entry] of this.tabs) if (entry.targetId === targetId) return tabId;
    return undefined;
  }

  /**
   * Whether a run is in progress: active in the last snapshot, or handed a tab within the grace
   * and not listed yet (the shell sends `tab.hand` before the snapshot that shows the run).
   */
  isActiveRun(runId: string): boolean {
    const status = this.statuses.get(runId);
    if (status !== undefined) return isActiveStatus(status);
    if (this.seenRuns.has(runId)) return false;
    const now = Date.now();
    return [...this.tabs.values()].some(
      (entry) => entry.runId === runId && now - entry.since < HAND_GRACE_MS,
    );
  }

  /** Owned tabs of active runs: the only tabs the debugger may attach to. */
  activeTabs(): number[] {
    return [...this.tabs]
      .filter(([, entry]) => this.isActiveRun(entry.runId))
      .map(([tabId]) => tabId);
  }

  /** The active run that took a tab most recently: the run a page the worker opens belongs to. */
  latestActiveRun(): string | undefined {
    let latest: OwnedTab | undefined;
    for (const entry of this.tabs.values())
      if (this.isActiveRun(entry.runId) && (latest === undefined || entry.since > latest.since))
        latest = entry;
    return latest?.runId;
  }

  /** The run takes the tab (a tab another run owned changes hands). */
  own(tabId: number, runId: string, targetId: string | undefined): void {
    const previous = this.tabs.get(tabId);
    const kept = previous?.runId === runId ? previous.targetId : undefined;
    const known = targetId ?? kept;
    this.tabs.set(tabId, {
      runId,
      since: Date.now(),
      ...(known === undefined ? {} : { targetId: known }),
    });
    this.released.delete(`${runId}:${tabId}`);
    this.changed();
  }

  setTargetId(tabId: number, targetId: string): void {
    const entry = this.tabs.get(tabId);
    if (entry === undefined || entry.targetId === targetId) return;
    entry.targetId = targetId;
    this.schedulePersist();
  }

  /** Notes the person's input; false when the tab is not owned or the input was Atd's echo. */
  noteInput(tabId: number): boolean {
    const entry = this.tabs.get(tabId);
    const now = Date.now();
    if (entry === undefined || now - (this.atdInputAt.get(tabId) ?? 0) < ATD_INPUT_ECHO_MS)
      return false;
    entry.lastInputAt = now;
    return true;
  }

  /** Whether the person released the tab from this run (`release`). */
  wasReleased(runId: string, tabId: number): boolean {
    return this.released.has(`${runId}:${tabId}`);
  }

  /** Atd dispatched input into the tab (`Debuggee` forwarding `Input.*`). */
  noteAtdInput(tabId: number): void {
    this.atdInputAt.set(tabId, Date.now());
  }

  /** The person let the tab go: ownership ends and the same run does not take it back. */
  release(tabId: number): OwnedTab | undefined {
    const entry = this.tabs.get(tabId);
    if (entry === undefined) return undefined;
    this.tabs.delete(tabId);
    this.released.add(`${entry.runId}:${tabId}`);
    this.changed();
    return entry;
  }

  /** Chrome swapped the tab's contents (`tabs.onReplaced`): ownership moves to the new id. */
  replace(removedTabId: number, addedTabId: number): boolean {
    const entry = this.tabs.get(removedTabId);
    if (entry === undefined) return false;
    this.tabs.delete(removedTabId);
    this.tabs.set(addedTabId, { runId: entry.runId, since: entry.since });
    this.changed();
    return true;
  }

  /**
   * Applies a `runs` snapshot: tabs whose run ended or left it are dropped and returned. The tabs
   * a run lists never become owned here: the shell lists only tabs this worker reported to it.
   */
  applyRuns(runs: readonly RunView[]): number[] {
    this.statuses = new Map(runs.map((run) => [run.runId, run.status]));
    // The shell sends a snapshot for every step of a run, so storage is written only when what it
    // keeps changed: the tabs (`changed`), the runs seen (exactly the listed ones) or the releases.
    const sameRuns =
      this.seenRuns.size === this.statuses.size &&
      [...this.seenRuns].every((runId) => this.statuses.has(runId));
    for (const runId of this.seenRuns) if (!this.statuses.has(runId)) this.seenRuns.delete(runId);
    for (const run of runs) this.seenRuns.add(run.runId);
    const dropped: number[] = [];
    for (const [tabId, entry] of this.tabs) {
      if (this.isActiveRun(entry.runId)) continue;
      this.tabs.delete(tabId);
      dropped.push(tabId);
    }
    const releases = this.released.size;
    for (const pair of this.released)
      if (!this.statuses.has(pair.slice(0, pair.lastIndexOf(':')))) this.released.delete(pair);
    if (dropped.length > 0) this.changed();
    else if (!sameRuns || this.released.size !== releases) this.schedulePersist();
    return dropped;
  }

  private changed(): void {
    for (const tabId of this.atdInputAt.keys())
      if (!this.tabs.has(tabId)) this.atdInputAt.delete(tabId);
    this.schedulePersist();
    for (const listener of this.listeners) listener();
  }

  private schedulePersist(): void {
    if (this.persistScheduled) return;
    this.persistScheduled = true;
    queueMicrotask(() => {
      this.persistScheduled = false;
      const tabs = [...this.tabs].map(([tabId, { runId, since, targetId }]) => ({
        tabId,
        runId,
        since,
        ...(targetId === undefined ? {} : { targetId }),
      }));
      const value = { tabs, seenRuns: [...this.seenRuns], released: [...this.released] };
      chrome.storage.session.set({ [SESSION_KEY]: value }).catch((error: unknown) => {
        console.warn('[atd] could not keep the owned tabs', error);
      });
    });
  }
}
