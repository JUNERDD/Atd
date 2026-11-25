import type { RunView } from '../channel/payloads.ts';
import { t } from './i18n.ts';
import type { OwnedTabs } from './owned-tabs.ts';
import { isActiveStatus, needsPerson, projectRuns } from './projection.ts';
import type { Store } from './store.ts';
import type { TabGroups } from './tab-group.ts';

/**
 * The browser-level indicators of runs (D9, D10, spec 13): the toolbar badge and the Atd tab
 * groups. Badge: "!" on orange while a run needs the person, else the number of runs in progress
 * on cyan (grey while the channel is down and they show their last known state), cleared when
 * none is. Repaints are coalesced and run one at a time.
 */

/** The prototype's group colors, so the badge matches the group beside it. */
const CYAN = '#12a4b8';
const ORANGE = '#e8710a';
const GREY = '#8e8e93';
const BADGE_TEXT = '#ffffff';

interface BadgeLook {
  text: string;
  color: string;
  title: string;
}

export class Indicators {
  private dirty = false;
  private running = false;
  private badge = '';

  constructor(
    private readonly store: Store,
    private readonly owned: OwnedTabs,
    private readonly groups: TabGroups,
  ) {}

  /** Repaints soon; calls while a repaint runs fold into one more. */
  schedule(): void {
    this.dirty = true;
    if (!this.running) void this.run();
  }

  private async run(): Promise<void> {
    this.running = true;
    while (this.dirty) {
      this.dirty = false;
      try {
        await this.paint();
      } catch (error) {
        console.warn('[atd] could not update the toolbar badge or tab group', error);
      }
    }
    this.running = false;
  }

  private async paint(): Promise<void> {
    const runs = projectRuns(this.store.state);
    await this.paintBadge(badgeLook(runs));
    const attentionTabs = new Set(
      runs
        .filter((run) => needsPerson(run.status))
        .flatMap((run) => [...run.tabs, ...this.owned.tabsOf(run.runId)]),
    );
    const windows = new Set<number>();
    for (const tabId of attentionTabs) {
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      if (tab !== undefined) windows.add(tab.windowId);
    }
    await this.groups.paint(windows, t('group.needsYou'));
  }

  private async paintBadge(look: BadgeLook): Promise<void> {
    const key = JSON.stringify(look);
    if (key === this.badge) return;
    await Promise.all([
      chrome.action.setBadgeText({ text: look.text }),
      chrome.action.setBadgeBackgroundColor({ color: look.color }),
      chrome.action.setBadgeTextColor({ color: BADGE_TEXT }),
      chrome.action.setTitle({ title: look.title }),
    ]);
    this.badge = key;
  }
}

function badgeLook(runs: readonly RunView[]): BadgeLook {
  if (runs.some((run) => needsPerson(run.status)))
    return { text: '!', color: ORANGE, title: t('action.needsYou') };
  const active = runs.filter((run) => isActiveStatus(run.status));
  // No run in progress: the manifest's own tooltip.
  if (active.length === 0)
    return { text: '', color: CYAN, title: chrome.i18n.getMessage('actionTitle') };
  const offline = active.every((run) => run.status === 'disconnected');
  return {
    text: String(active.length),
    color: offline ? GREY : CYAN,
    title: offline ? t('action.disconnected') : t('action.working', { count: active.length }),
  };
}
