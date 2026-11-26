import type { ExtensionFrameBody } from '../channel/protocol.ts';
import type { RunView } from '../channel/payloads.ts';
import type { ContentInjector } from './inject.ts';
import { clipText, type SendFrame } from './native.ts';
import type { OwnedTabs } from './owned-tabs.ts';
import type { Pointers } from './pointer.ts';
import type { TabGroups } from './tab-group.ts';
import { isOpenableUrl } from './urls.ts';

type ReleaseReason = ExtensionFrameBody<'tab.released'>['reason'];

/** `chrome.debugger.getTargets` lists a new tab's target shortly after the tab exists. */
const TARGET_ATTEMPTS = 10;
const TARGET_RETRY_MS = 100;

/**
 * Taking and letting go of tabs (D9), with every Chrome side effect: the Atd group, the tab's
 * CDP target id, the content script for its HUD, and the frames that keep the shell informed
 * (`tab.handed`, `tab.opened`, `tab.state`, `tab.released`). Debugger attachments follow from
 * ownership changes through `OwnedTabs.onChange` (translator.ts).
 */
export class Ownership {
  constructor(
    private readonly owned: OwnedTabs,
    private readonly groups: TabGroups,
    private readonly injector: ContentInjector,
    private readonly pointers: Pointers,
    private readonly send: SendFrame,
  ) {}

  /**
   * `tab.hand` (only for the tab an ask with its page came from, see shell-frames.ts): the run
   * takes the tab it was asked from. Ownership is recorded before anything is awaited, so a worker
   * command arriving meanwhile already sees the tab. The shell then learns the tab's target and
   * URL (`tab.handed`, then `tab.state`) before the slower grouping and injection: until it knows
   * the URL, its access check does not see that the run has the page and would open it again. A
   * repeated hand for the same run only reports the tab again.
   */
  async hand(runId: string, tabId: number): Promise<void> {
    if (this.owned.wasReleased(runId, tabId)) {
      console.info(`[atd] tab ${tabId} was released from its run; it is not taken back`);
      return;
    }
    if (this.owned.get(tabId)?.runId !== runId) this.owned.own(tabId, runId, undefined);
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab === undefined) {
      this.release(tabId, 'closed');
      return;
    }
    const targetId = await this.resolveTarget(tabId);
    if (targetId !== undefined) this.send({ t: 'tab.handed', runId, tabId, targetId });
    await this.reportState(tabId);
    await this.groups.take(tabId, tab.windowId);
    await this.letGoIfReleased(tabId);
    await this.injector.ensure(tabId);
  }

  /** `tab.open`: a background tab in the run's group, answered by `tab.opened` or `tab.openFailed`. */
  async open(requestId: string, runId: string, url: string): Promise<void> {
    try {
      const tabId = await this.openForRun(runId, url);
      const targetId = this.owned.get(tabId)?.targetId;
      if (targetId !== undefined) this.send({ t: 'tab.opened', requestId, tabId, targetId });
      else this.send({ t: 'tab.openFailed', requestId, reason: 'The tab has no debugger target.' });
    } catch (error) {
      console.warn('[atd] could not open a tab for the run', error);
      this.send({ t: 'tab.openFailed', requestId, reason: String(error).slice(0, 500) });
    }
  }

  /**
   * Opens `url` in a background tab of the run's window (where its tabs are) and owns it. Only
   * web pages: a run never opens browser or extension pages, files or scripts.
   */
  async openForRun(runId: string, url: string): Promise<number> {
    if (!isOpenableUrl(url)) throw new Error('Atd opens only web pages in Chrome.');
    const anchor = await this.runWindow(runId);
    const tab = await chrome.tabs.create({
      url,
      active: false,
      ...(anchor === undefined ? {} : { windowId: anchor }),
    });
    if (tab.id === undefined) throw new Error('Chrome opened no tab.');
    this.owned.own(tab.id, runId, undefined);
    await this.groups.add(tab.id, tab.windowId);
    await this.letGoIfReleased(tab.id);
    await this.resolveTarget(tab.id);
    await this.reportState(tab.id);
    return tab.id;
  }

  /** `tabs.onCreated`: a popup (or tab) an owned tab of an active run opened joins that run. */
  async adoptOpened(tab: chrome.tabs.Tab): Promise<void> {
    if (tab.id === undefined || tab.openerTabId === undefined) return;
    const opener = this.owned.get(tab.openerTabId);
    if (opener === undefined || !this.owned.isActiveRun(opener.runId)) return;
    this.owned.own(tab.id, opener.runId, undefined);
    await this.groups.add(tab.id, tab.windowId);
    await this.letGoIfReleased(tab.id);
    await this.resolveTarget(tab.id);
    await this.reportState(tab.id);
  }

  /**
   * A `runs` snapshot: tabs of runs that ended or left it are let go (the shell needs no frame
   * for them), together, so Atd's grouping of them is undone at once (`TabGroups.letGo`): back
   * to the person's group and place they came from, or out of the Atd group. Tabs of runs still
   * active stay in it.
   */
  async applyRuns(runs: readonly RunView[]): Promise<void> {
    const dropped = this.owned.applyRuns(runs);
    for (const tabId of dropped) this.pointers.clear(tabId);
    await this.groups.letGo(dropped);
  }

  /**
   * The tab left its run (`reason`): the shell hears why, and the run stops using it. A tab the
   * person closed or ungrouped stays where it is; one still in the Atd group leaves it, back to
   * the person's group and place it came from (`TabGroups.letGo`).
   */
  release(tabId: number, reason: ReleaseReason): void {
    if (this.owned.release(tabId) === undefined) return;
    this.pointers.clear(tabId);
    this.send({ t: 'tab.released', tabId, reason });
    if (reason === 'closed' || reason === 'ungrouped') this.groups.forgetTab(tabId);
    else void this.groups.letGo([tabId]);
  }

  /**
   * `chrome.debugger.onDetach` for an owned tab. Cancel on Chrome's "started debugging" bar ends
   * every attachment at once, each reported as released by the person (the shell stops the run).
   * Any other detach of a tab that is gone releases it; a tab that still exists (it showed a page
   * Chrome keeps from extensions) stays owned and is attached again by `retryAttach`.
   */
  async debuggerDetached(
    tabId: number,
    reason: `${chrome.debugger.DetachReason}`,
    retryAttach: () => void,
  ): Promise<void> {
    if (this.owned.get(tabId) === undefined) return;
    if (reason === 'canceled_by_user') {
      this.release(tabId, 'canceledByUser');
      return;
    }
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab === undefined) this.release(tabId, 'detached');
    else retryAttach();
  }

  /** An owned tab's group changed: out of every Atd group means the person ungrouped it. */
  async groupChanged(tabId: number): Promise<void> {
    if (this.owned.get(tabId) === undefined) return;
    // Grouping by the extension itself reports the new group before `tabs.group` resolves.
    await this.groups.settled();
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab !== undefined && !this.groups.isAtdGroup(tab.groupId)) this.release(tabId, 'ungrouped');
  }

  /**
   * `tabs.onReplaced`: Chrome swapped the tab's contents under a new id. The run keeps the new
   * tab; the shell hears that the old id is gone and gets the new one's state.
   */
  async replaced(addedTabId: number, removedTabId: number): Promise<void> {
    if (!this.owned.replace(removedTabId, addedTabId)) return;
    this.pointers.clear(removedTabId);
    this.groups.replaceTab(removedTabId, addedTabId);
    this.send({ t: 'tab.released', tabId: removedTabId, reason: 'closed' });
    await this.takeOver(addedTabId);
  }

  noteInput(tabId: number): void {
    if (this.owned.noteInput(tabId)) void this.reportState(tabId);
  }

  /** `tab.state` for one owned tab (its run, URL, title, active and focused, last input). */
  async reportState(tabId: number): Promise<void> {
    const entry = this.owned.get(tabId);
    if (entry === undefined) return;
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab === undefined) return;
    const window = await chrome.windows.get(tab.windowId).catch(() => undefined);
    this.send({
      t: 'tab.state',
      tabId,
      runId: entry.runId,
      ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
      url: clipText(tab.url),
      title: clipText(tab.title),
      active: tab.active,
      focused: tab.active && window?.focused === true,
      ...(entry.lastInputAt === undefined ? {} : { lastInputAt: entry.lastInputAt }),
    });
  }

  /** `tab.state` for every owned tab (activation and window focus change several at once). */
  reportAll(): void {
    for (const tabId of this.owned.ownedTabIds()) void this.reportState(tabId);
  }

  /** A tab that became owned under a new id (`tabs.onReplaced`): grouped, injected, reported. */
  private async takeOver(tabId: number): Promise<void> {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab === undefined) {
      this.release(tabId, 'closed');
      return;
    }
    await this.groups.add(tabId, tab.windowId);
    await this.letGoIfReleased(tabId);
    await this.resolveTarget(tabId);
    await this.injector.ensure(tabId);
    await this.reportState(tabId);
  }

  /**
   * Ownership can end while a group change waits its turn (a snapshot ends the run, Cancel on
   * Chrome's bar): its let-go then ran before the tab was grouped, so it runs again.
   */
  private async letGoIfReleased(tabId: number): Promise<void> {
    if (this.owned.get(tabId) === undefined) await this.groups.letGo([tabId]);
  }

  /** The tab's CDP target id, recorded on its ownership. */
  private async resolveTarget(tabId: number): Promise<string | undefined> {
    for (let attempt = 0; attempt < TARGET_ATTEMPTS; attempt += 1) {
      const targets = await chrome.debugger.getTargets();
      const targetId = targets.find((target) => target.tabId === tabId)?.id;
      if (targetId !== undefined) {
        this.owned.setTargetId(tabId, targetId);
        return targetId;
      }
      await new Promise((resolve) => setTimeout(resolve, TARGET_RETRY_MS));
    }
    console.warn(`[atd] found no debugger target for tab ${tabId}`);
    return undefined;
  }

  /** The normal window holding one of the run's tabs, if any. */
  private async runWindow(runId: string): Promise<number | undefined> {
    for (const tabId of this.owned.tabsOf(runId)) {
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      const window =
        tab === undefined
          ? undefined
          : await chrome.windows.get(tab.windowId).catch(() => undefined);
      if (window?.type === 'normal' && window.id !== undefined) return window.id;
    }
    return undefined;
  }
}
