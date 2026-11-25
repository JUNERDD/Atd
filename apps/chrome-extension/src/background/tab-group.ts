import { Type } from 'typebox';
import { Value } from 'typebox/value';

/**
 * The "Atd" tab group (D9, spec 13): one per window, holding the tabs runs own there. Cyan while
 * Atd works, orange and titled "Needs you" while a run there waits for the person; it stays when
 * a run ends, so the person still finds the tabs. A tab that was in one of the person's groups
 * when Atd grouped it goes back there when Atd lets it go, if that group is still in its window.
 * Group ids live in `chrome.storage.session` (they last as long as the browser session), so a
 * restarted worker keeps using the same groups.
 */

/** The group's name is the brand, never translated. */
const GROUP_TITLE = 'Atd';
const SESSION_KEY = 'atd.tabGroups';

type GroupLook = { title: string; color: `${chrome.tabGroups.Color}` };

const StoredSchema = Type.Object({
  groups: Type.Array(
    Type.Object({ windowId: Type.Integer(), groupId: Type.Integer({ minimum: 0 }) }),
  ),
  previous: Type.Array(
    Type.Object({ tabId: Type.Integer({ minimum: 0 }), groupId: Type.Integer({ minimum: 0 }) }),
  ),
});

export class TabGroups {
  private readonly byWindow = new Map<number, number>();
  /** The person's group each tab was in when Atd grouped it, by tab id. */
  private readonly previous = new Map<number, number>();
  /** The look last applied to each group, so an unchanged look is not applied again. */
  private readonly painted = new Map<number, string>();
  /** Group changes run one at a time: two tabs grouped at once must not create two groups. */
  private queue: Promise<void> = Promise.resolve();

  async restore(): Promise<void> {
    const stored = await chrome.storage.session.get(SESSION_KEY);
    const value: unknown = stored[SESSION_KEY];
    if (!Value.Check(StoredSchema, value)) return;
    for (const { windowId, groupId } of value.groups)
      if (await groupInWindow(groupId, windowId)) this.byWindow.set(windowId, groupId);
    for (const { tabId, groupId } of value.previous) this.previous.set(tabId, groupId);
  }

  isAtdGroup(groupId: number): boolean {
    return [...this.byWindow.values()].includes(groupId);
  }

  /** Resolves once every pending group change is done. */
  settled(): Promise<void> {
    return this.queue;
  }

  /** Puts the tab in its window's Atd group (created on demand); normal windows only. */
  add(tabId: number, windowId: number): Promise<void> {
    return this.enqueue(async () => {
      const window = await chrome.windows.get(windowId).catch(() => undefined);
      // Popup and app windows cannot hold tab groups.
      if (window?.type !== 'normal') return;
      await this.notePrevious(tabId);
      const existing = this.byWindow.get(windowId);
      if (existing !== undefined && (await groupInWindow(existing, windowId))) {
        await chrome.tabs.group({ groupId: existing, tabIds: tabId });
        return;
      }
      const groupId = await chrome.tabs.group({ tabIds: tabId, createProperties: { windowId } });
      this.byWindow.set(windowId, groupId);
      this.persist();
      await this.apply(groupId, { title: GROUP_TITLE, color: 'cyan' });
    });
  }

  /**
   * Gives each group its look: attention (orange, `needsYouTitle`) in the windows listed, the
   * working look everywhere else.
   */
  paint(attentionWindows: ReadonlySet<number>, needsYouTitle: string): Promise<void> {
    return this.enqueue(async () => {
      for (const [windowId, groupId] of this.byWindow) {
        const look: GroupLook = attentionWindows.has(windowId)
          ? { title: needsYouTitle, color: 'orange' }
          : { title: GROUP_TITLE, color: 'cyan' };
        await this.apply(groupId, look);
      }
    });
  }

  /**
   * Atd let the tab go (its run ended, or ownership ended without the person moving or closing
   * the tab): it returns to the group it was in before Atd grouped it when that group is still in
   * the tab's window, and stays in the Atd group otherwise. A tab the person moved out of the Atd
   * group meanwhile stays where they put it.
   */
  restoreTab(tabId: number): Promise<void> {
    const groupId = this.previous.get(tabId);
    if (groupId === undefined) return Promise.resolve();
    this.forgetTab(tabId);
    return this.enqueue(async () => {
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      if (tab === undefined || !this.isAtdGroup(tab.groupId)) return;
      if (await groupInWindow(groupId, tab.windowId))
        await chrome.tabs.group({ groupId, tabIds: tabId });
    });
  }

  /** The person closed or ungrouped the tab: where it goes is theirs to say. */
  forgetTab(tabId: number): void {
    if (this.previous.delete(tabId)) this.persist();
  }

  /** `tabs.onReplaced`: the tab's earlier group carries over to its new id. */
  replaceTab(removedTabId: number, addedTabId: number): void {
    const groupId = this.previous.get(removedTabId);
    if (groupId === undefined) return;
    this.previous.delete(removedTabId);
    this.previous.set(addedTabId, groupId);
    this.persist();
  }

  /** The group is gone (`tabGroups.onRemoved`: closed, or its last tab left). */
  forget(groupId: number): void {
    for (const [windowId, id] of this.byWindow) if (id === groupId) this.byWindow.delete(windowId);
    this.painted.delete(groupId);
    this.persist();
  }

  private async apply(groupId: number, look: GroupLook): Promise<void> {
    const key = `${look.title}\n${look.color}`;
    if (this.painted.get(groupId) === key) return;
    try {
      await chrome.tabGroups.update(groupId, look);
      this.painted.set(groupId, key);
    } catch {
      this.forget(groupId);
    }
  }

  /** Records the person's group the tab is in, unless it is an Atd group or already recorded. */
  private async notePrevious(tabId: number): Promise<void> {
    if (this.previous.has(tabId)) return;
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (
      tab === undefined ||
      tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE ||
      this.isAtdGroup(tab.groupId)
    )
      return;
    this.previous.set(tabId, tab.groupId);
    this.persist();
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch((error: unknown) => {
      console.warn('[atd] could not update the Atd tab group', error);
    });
    return this.queue;
  }

  private persist(): void {
    const groups = [...this.byWindow].map(([windowId, groupId]) => ({ windowId, groupId }));
    const previous = [...this.previous].map(([tabId, groupId]) => ({ tabId, groupId }));
    chrome.storage.session.set({ [SESSION_KEY]: { groups, previous } }).catch(() => undefined);
  }
}

async function groupInWindow(groupId: number, windowId: number): Promise<boolean> {
  const group = await chrome.tabGroups.get(groupId).catch(() => undefined);
  return group?.windowId === windowId;
}
