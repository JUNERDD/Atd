import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { RunView } from '../channel/payloads.ts';

/**
 * The runs this extension's asks started, each tied to the tab it was asked from (`ask.accepted`
 * names the run of a request id `PendingRequests` remembers). The tie decides two things:
 *
 * - `tab.hand` is honored only for the tab an ask with its page came from. Atd hands no other
 *   tab: everything else a run uses it opens itself (`tab.open`, `Target.createTarget`).
 * - An ask without its page still shows its run in that tab's HUD (and lets the HUD's controls
 *   act on it), but the run never owns the tab: no group, no debugger, no `tab.state`.
 *
 * Links live in `chrome.storage.session`, so a restarted worker keeps them, until their run leaves
 * the `runs` snapshot (or never appears in one) or their tab closes.
 */

const SESSION_KEY = 'atd.runLinks';
/** An accepted run no snapshot has listed yet is kept this long (the snapshot follows at once). */
const UNLISTED_MS = 60_000;

const LinkSchema = Type.Object({
  runId: Type.String({ minLength: 1 }),
  tabId: Type.Integer({ minimum: 0 }),
  withPage: Type.Boolean(),
  at: Type.Number(),
  listed: Type.Boolean(),
});
type Link = Static<typeof LinkSchema>;

export class RunLinks {
  private readonly links = new Map<string, Link>();
  private persistScheduled = false;

  /** `changed` is told whenever which runs a tab shows may have changed. */
  constructor(private readonly changed: () => void) {}

  async restore(): Promise<void> {
    const stored = await chrome.storage.session.get(SESSION_KEY);
    const value: unknown = stored[SESSION_KEY];
    if (!Value.Check(Type.Array(LinkSchema), value)) return;
    for (const link of value) this.links.set(link.runId, link);
  }

  /** Atd accepted an ask from `tabId` (`withPage`: the ask carried the tab's page). */
  accepted(runId: string, tabId: number, withPage: boolean): void {
    this.links.set(runId, { runId, tabId, withPage, at: Date.now(), listed: false });
    this.update();
  }

  /** Whether `tab.hand {runId, tabId}` answers an ask with its page from that tab. */
  mayHand(runId: string, tabId: number): boolean {
    const link = this.links.get(runId);
    return link?.withPage === true && link.tabId === tabId;
  }

  /**
   * Whether Atd accepted an ask with its page from the tab and no snapshot lists its run yet: the
   * tab's HUD already shows the run starting, before the run itself reaches the tab.
   */
  starting(tabId: number): boolean {
    for (const link of this.links.values())
      if (link.withPage && !link.listed && link.tabId === tabId) return true;
    return false;
  }

  /** Runs asked from the tab without its page: its HUD shows them though they do not own it. */
  displayRuns(tabId: number): string[] {
    return [...this.links.values()]
      .filter((link) => !link.withPage && link.tabId === tabId)
      .map((link) => link.runId);
  }

  /** A `runs` snapshot: a run it no longer lists is over, and so is its link. */
  applyRuns(runs: readonly RunView[]): void {
    const listed = new Set(runs.map((run) => run.runId));
    const now = Date.now();
    let changed = false;
    for (const [runId, link] of this.links) {
      if (listed.has(runId)) {
        changed ||= !link.listed;
        link.listed = true;
      } else if (link.listed || now - link.at > UNLISTED_MS) {
        this.links.delete(runId);
        changed = true;
      }
    }
    if (changed) this.update();
  }

  tabClosed(tabId: number): void {
    let changed = false;
    for (const [runId, link] of this.links)
      if (link.tabId === tabId) {
        this.links.delete(runId);
        changed = true;
      }
    if (changed) this.update();
  }

  /** `tabs.onReplaced`: the links move to the tab's new id. */
  tabReplaced(removedTabId: number, addedTabId: number): void {
    let changed = false;
    for (const link of this.links.values())
      if (link.tabId === removedTabId) {
        link.tabId = addedTabId;
        changed = true;
      }
    if (changed) this.update();
  }

  private update(): void {
    this.changed();
    if (this.persistScheduled) return;
    this.persistScheduled = true;
    queueMicrotask(() => {
      this.persistScheduled = false;
      chrome.storage.session
        .set({ [SESSION_KEY]: [...this.links.values()] })
        .catch((error: unknown) => console.warn('[atd] could not keep the runs of asks', error));
    });
  }
}
