import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { RunView } from '../channel/payloads.ts';
import { ENDED_RUN_STATUSES } from '../messages/views.ts';

/**
 * The ended runs whose HUD left a tab: the person dismissed it there, or it hid on its own (Done
 * without a reply, Stopped). The shell keeps ended runs listed for a while, so without this every
 * reload or navigation of the tab would show the capsule again; the tab's view leaves such a run
 * out instead (`runForTab`). Hiding is the tab's own: only an explicit Dismiss also tells the shell
 * (`run.dismiss`).
 *
 * Kept per (run, tab) in `chrome.storage.session`, so a restarted worker keeps them, until a
 * `runs` snapshot no longer lists the run as ended (it is gone, or live again and shows again), or
 * the tab closes.
 */

const SESSION_KEY = 'atd.hiddenRuns';
const NONE: ReadonlySet<string> = new Set();

const EntrySchema = Type.Object({
  runId: Type.String({ minLength: 1 }),
  tabId: Type.Integer({ minimum: 0 }),
});

export class HiddenRuns {
  /** The hidden runs' ids per tab. */
  private readonly tabs = new Map<number, Set<string>>();
  private persistScheduled = false;

  /** `changed` is told whenever which run a tab shows may have changed. */
  constructor(private readonly changed: () => void) {}

  async restore(): Promise<void> {
    const stored = await chrome.storage.session.get(SESSION_KEY);
    const value: unknown = stored[SESSION_KEY];
    if (!Value.Check(Type.Array(EntrySchema), value)) return;
    for (const { runId, tabId } of value) this.runsOf(tabId).add(runId);
  }

  /** The ended run's HUD left `tabId`: it stays away from that tab. */
  hide(runId: string, tabId: number): void {
    const runs = this.runsOf(tabId);
    if (runs.has(runId)) return;
    runs.add(runId);
    this.update();
  }

  /** The runs hidden in `tabId`. */
  inTab(tabId: number): ReadonlySet<string> {
    return this.tabs.get(tabId) ?? NONE;
  }

  /** A `runs` snapshot: a run it no longer lists as ended is not hidden anywhere any more. */
  applyRuns(runs: readonly RunView[]): void {
    const ended = new Set(
      runs.filter((run) => ENDED_RUN_STATUSES.includes(run.status)).map((run) => run.runId),
    );
    let changed = false;
    for (const [tabId, hidden] of this.tabs) {
      for (const runId of hidden) {
        if (ended.has(runId)) continue;
        hidden.delete(runId);
        changed = true;
      }
      if (hidden.size === 0) this.tabs.delete(tabId);
    }
    if (changed) this.update();
  }

  tabClosed(tabId: number): void {
    if (this.tabs.delete(tabId)) this.update();
  }

  /** `tabs.onReplaced`: what was hidden moves to the tab's new id. */
  tabReplaced(removedTabId: number, addedTabId: number): void {
    const hidden = this.tabs.get(removedTabId);
    if (hidden === undefined) return;
    this.tabs.delete(removedTabId);
    for (const runId of hidden) this.runsOf(addedTabId).add(runId);
    this.update();
  }

  private runsOf(tabId: number): Set<string> {
    let runs = this.tabs.get(tabId);
    if (runs === undefined) {
      runs = new Set();
      this.tabs.set(tabId, runs);
    }
    return runs;
  }

  private update(): void {
    this.changed();
    if (this.persistScheduled) return;
    this.persistScheduled = true;
    queueMicrotask(() => {
      this.persistScheduled = false;
      const entries = [...this.tabs].flatMap(([tabId, runs]) =>
        [...runs].map((runId) => ({ runId, tabId })),
      );
      chrome.storage.session
        .set({ [SESSION_KEY]: entries })
        .catch((error: unknown) => console.warn('[atd] could not keep the hidden runs', error));
    });
  }
}
