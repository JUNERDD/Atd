import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { BackgroundDiagReporter } from '../diagnostics/recorder.ts';

/**
 * The "Atd" tab group (D9, spec 13): one per window, holding the tabs runs own there. Cyan while
 * Atd works, orange and titled "Needs you" while a run there waits for the person. When Atd lets
 * tabs go, it undoes its grouping (`letGo`): a tab it took from the person goes back to the
 * person's group and the place it had, every other tab leaves the Atd group, and Chrome removes a
 * group left empty. Group ids and what letting go needs live in `chrome.storage.session` (they
 * last as long as the browser session), so a restarted worker keeps using the same groups and can
 * still put tabs back.
 */

/** The group's name is the brand, never translated. */
const GROUP_TITLE = 'Atd';
const SESSION_KEY = 'atd.tabGroups';

type GroupLook = { title: string; color: `${chrome.tabGroups.Color}` };

/** Where a tab Atd took from the person was before it grouped the tab. */
interface Origin {
  /** The person's group the tab was in. */
  groupId?: number;
  /**
   * Set only when grouping moved the tab: the tab that was on its left, `null` when it was the
   * window's first tab.
   */
  after?: number | null;
}

/** A tab's place just before grouping. */
interface Place {
  index: number;
  left: number | null;
  /** The person's group the tab is in, if any. */
  groupId?: number;
}

const StoredSchema = Type.Object({
  groups: Type.Array(
    Type.Object({ windowId: Type.Integer(), groupId: Type.Integer({ minimum: 0 }) }),
  ),
  /** In the order Atd took the tabs. */
  origins: Type.Array(
    Type.Object({
      tabId: Type.Integer({ minimum: 0 }),
      groupId: Type.Optional(Type.Integer({ minimum: 0 })),
      after: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
    }),
  ),
});

export class TabGroups {
  private readonly byWindow = new Map<number, number>();
  /**
   * Where each tab Atd took from the person was (`take`), in the order it took them; only tabs
   * with somewhere to return to (a group of the person's, or a place grouping moved them from).
   */
  private origins = new Map<number, Origin>();
  /** The look last applied to each group, so an unchanged look is not applied again. */
  private readonly painted = new Map<number, string>();
  /** Group changes run one at a time: two tabs grouped at once must not create two groups. */
  private queue: Promise<void> = Promise.resolve();

  /** Loads what the last worker lifetime kept; a stored value of another shape is ignored. */
  async restore(onDiagnostic?: BackgroundDiagReporter): Promise<void> {
    const stored = await chrome.storage.session.get(SESSION_KEY);
    const value: unknown = stored[SESSION_KEY];
    if (!Value.Check(StoredSchema, value)) {
      if (value !== undefined) {
        onDiagnostic?.({
          level: 'warn',
          cat: 'storage',
          code: 'invalid_tab_groups',
          msg: 'Ignored invalid stored tab-group state',
        });
      }
      return;
    }
    for (const { windowId, groupId } of value.groups)
      if (await groupInWindow(groupId, windowId)) this.byWindow.set(windowId, groupId);
    for (const { tabId, ...origin } of value.origins) this.origins.set(tabId, origin);
  }

  isAtdGroup(groupId: number): boolean {
    return [...this.byWindow.values()].includes(groupId);
  }

  /** Resolves once every pending group change is done. */
  settled(): Promise<void> {
    return this.queue;
  }

  /**
   * Groups a tab the person had, remembering where it was so `letGo` can put it back. A tab
   * already remembered keeps its first origin (a repeated hand, or a tab changing runs).
   */
  take(tabId: number, windowId: number): Promise<void> {
    return this.enqueue(async () => {
      if (!(await isNormalWindow(windowId))) return;
      const place = this.origins.has(tabId) ? undefined : await this.placeOf(tabId);
      await this.group(tabId, windowId);
      if (place === undefined) return;
      const now = await getTab(tabId);
      const moved = now !== undefined && now.index !== place.index;
      const origin: Origin = {
        ...(place.groupId === undefined ? {} : { groupId: place.groupId }),
        ...(moved ? { after: place.left } : {}),
      };
      if (origin.groupId === undefined && origin.after === undefined) return;
      this.origins.set(tabId, origin);
      this.persist();
    });
  }

  /**
   * Groups a tab its run opened, which has nowhere to go back to, or the new id of a tab whose
   * origin already carried over (`replaceTab`).
   */
  add(tabId: number, windowId: number): Promise<void> {
    return this.enqueue(async () => {
      if (await isNormalWindow(windowId)) await this.group(tabId, windowId);
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
   * Atd lets these tabs go (their runs ended, or ownership ended without the person moving or
   * closing them) and undoes its grouping, for all of them together:
   * 1. the ones still in an Atd group leave it in one call (one at a time, Chrome would move each
   *    to an edge of the shrinking group);
   * 2. a tab that was in one of the person's groups returns to it, when that group is still in
   *    the tab's window;
   * 3. a tab grouping moved goes back after the tab that was on its left, when that tab is still
   *    in its window. The latest taken goes first, so each move undoes one grouping in reverse
   *    and tabs let go together keep their order.
   * A tab the person moved out of the Atd group meanwhile stays where they put it; tabs are never
   * closed; a group left empty is removed by Chrome (`tabGroups.onRemoved` → `forget`).
   */
  letGo(tabIds: readonly number[]): Promise<void> {
    if (tabIds.length === 0) return Promise.resolve();
    return this.enqueue(async () => {
      const leaving = new Set(tabIds);
      const origins = new Map([...this.origins].filter(([tabId]) => leaving.has(tabId)));
      try {
        const tabs = await Promise.all(tabIds.map(getTab));
        const ours = tabs.filter(
          (tab): tab is IdentifiedTab => tab !== undefined && this.isAtdGroup(tab.groupId),
        );
        await ungroup(ours.map((tab) => tab.id));
        const homes = new Map<number, number[]>();
        for (const tab of ours) {
          const groupId = origins.get(tab.id)?.groupId;
          if (groupId !== undefined && (await groupInWindow(groupId, tab.windowId)))
            homes.set(groupId, [...(homes.get(groupId) ?? []), tab.id]);
        }
        for (const [groupId, ids] of homes) await addToGroup(groupId, ids);
        const oursIds = new Set(ours.map((tab) => tab.id));
        for (const [tabId, { after }] of [...origins].reverse())
          if (after !== undefined && oursIds.has(tabId))
            await putBack(tabId, after).catch(warnPutBack);
      } finally {
        for (const tabId of origins.keys()) this.origins.delete(tabId);
        if (origins.size > 0) this.persist();
      }
    });
  }

  /** The person closed or ungrouped the tab: where it goes is theirs to say. */
  forgetTab(tabId: number): void {
    if (this.origins.delete(tabId)) this.persist();
  }

  /**
   * `tabs.onReplaced` for an owned tab: its origin carries over to the new id, keeping its turn,
   * and so does every origin that names it as the tab on the left.
   */
  replaceTab(removedTabId: number, addedTabId: number): void {
    const named = [...this.origins].some(
      ([tabId, origin]) => tabId === removedTabId || origin.after === removedTabId,
    );
    if (!named) return;
    const rename = (tabId: number): number => (tabId === removedTabId ? addedTabId : tabId);
    this.origins = new Map(
      [...this.origins].map(([tabId, { after, ...rest }]) => [
        rename(tabId),
        {
          ...rest,
          ...(after === undefined ? {} : { after: after === null ? null : rename(after) }),
        },
      ]),
    );
    this.persist();
  }

  /** The group is gone (`tabGroups.onRemoved`: closed, or its last tab left). */
  forget(groupId: number): void {
    for (const [windowId, id] of this.byWindow) if (id === groupId) this.byWindow.delete(windowId);
    this.painted.delete(groupId);
    this.persist();
  }

  /** Puts the tab in its window's Atd group, created on demand. */
  private async group(tabId: number, windowId: number): Promise<void> {
    const existing = this.byWindow.get(windowId);
    if (existing !== undefined && (await groupInWindow(existing, windowId))) {
      await chrome.tabs.group({ groupId: existing, tabIds: tabId });
      return;
    }
    const groupId = await chrome.tabs.group({ tabIds: tabId, createProperties: { windowId } });
    this.byWindow.set(windowId, groupId);
    this.persist();
    await this.apply(groupId, { title: GROUP_TITLE, color: 'cyan' });
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

  /** The tab's index, its left neighbour, and the person's group it is in (not an Atd group). */
  private async placeOf(tabId: number): Promise<Place | undefined> {
    const tab = await getTab(tabId);
    if (tab === undefined) return undefined;
    const [left] =
      tab.index === 0
        ? []
        : await chrome.tabs.query({ windowId: tab.windowId, index: tab.index - 1 });
    const theirs =
      tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE && !this.isAtdGroup(tab.groupId);
    return {
      index: tab.index,
      left: left?.id ?? null,
      ...(theirs ? { groupId: tab.groupId } : {}),
    };
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch((error: unknown) => {
      console.warn('[atd] could not update the Atd tab group', error);
    });
    return this.queue;
  }

  private persist(): void {
    const groups = [...this.byWindow].map(([windowId, groupId]) => ({ windowId, groupId }));
    const origins = [...this.origins].map(([tabId, origin]) => ({ tabId, ...origin }));
    chrome.storage.session.set({ [SESSION_KEY]: { groups, origins } }).catch(() => undefined);
  }
}

type IdentifiedTab = chrome.tabs.Tab & { id: number };

async function getTab(tabId: number): Promise<IdentifiedTab | undefined> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  return tab?.id === undefined ? undefined : { ...tab, id: tab.id };
}

/** Popup and app windows cannot hold tab groups. */
async function isNormalWindow(windowId: number): Promise<boolean> {
  const window = await chrome.windows.get(windowId).catch(() => undefined);
  return window?.type === 'normal';
}

async function groupInWindow(groupId: number, windowId: number): Promise<boolean> {
  const group = await chrome.tabGroups.get(groupId).catch(() => undefined);
  return group?.windowId === windowId;
}

/** Takes the tabs out of their groups in one call, or one by one if a tab is gone meanwhile. */
async function ungroup(tabIds: readonly number[]): Promise<void> {
  const [first, ...rest] = tabIds;
  if (first === undefined) return;
  try {
    await chrome.tabs.ungroup([first, ...rest]);
  } catch {
    for (const tabId of tabIds) await chrome.tabs.ungroup(tabId).catch(warnPutBack);
  }
}

async function addToGroup(groupId: number, tabIds: readonly number[]): Promise<void> {
  const [first, ...rest] = tabIds;
  if (first !== undefined)
    await chrome.tabs.group({ groupId, tabIds: [first, ...rest] }).catch(warnPutBack);
}

/**
 * Moves the tab back after `after` (`null`: to the front) when that tab is still in its window.
 * The move keeps the tab's group (the person's group it returned to, or none): Chrome adds a tab
 * moved inside a group's span to that group, and takes one moved off its group's edge out of it.
 */
async function putBack(tabId: number, after: number | null): Promise<void> {
  const tab = await getTab(tabId);
  if (tab === undefined) return;
  let index = 0;
  if (after !== null) {
    const left = await getTab(after);
    if (left === undefined || left.windowId !== tab.windowId) return;
    index = left.index < tab.index ? left.index + 1 : left.index;
  }
  if (index === tab.index) return;
  const moved = await chrome.tabs.move(tabId, { index });
  if (moved.groupId === tab.groupId) return;
  if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) await chrome.tabs.ungroup(tabId);
  else await chrome.tabs.group({ groupId: tab.groupId, tabIds: tabId });
}

function warnPutBack(error: unknown): void {
  console.warn('[atd] could not put a tab back where it was', error);
}
