import type { ShellFrameOf } from '../channel/protocol.ts';
import type { PointerView } from '../messages/views.ts';
import type { OwnedTabs } from './owned-tabs.ts';
import type { Surfaces } from './surfaces.ts';

/**
 * The live pointer (D10): the shell's `pointer` frame names a page by its CDP target id, which
 * maps to the owned tab reporting it; that tab's content script draws it. A tab whose pointer is
 * showing gets an explicit hide when it is cleared, its run ends or the tab is released.
 */
export class Pointers {
  private readonly shown = new Set<number>();

  constructor(
    private readonly owned: OwnedTabs,
    private readonly surfaces: Surfaces,
  ) {}

  apply(frame: ShellFrameOf<'pointer'>): void {
    const tabId = this.owned.tabWithTarget(frame.pageId);
    if (tabId === undefined) return;
    if (frame.phase === 'cleared') {
      this.clear(tabId);
      return;
    }
    const pointer: PointerView = {
      phase: frame.phase,
      label: frame.label,
      ...(frame.rect === undefined ? {} : { rect: frame.rect }),
      ...(frame.viewport === undefined ? {} : { viewport: frame.viewport }),
    };
    if (this.surfaces.postToTab(tabId, { type: 'pointer', pointer })) this.shown.add(tabId);
  }

  clear(tabId: number): void {
    if (!this.shown.delete(tabId)) return;
    this.surfaces.postToTab(tabId, { type: 'pointer', pointer: null });
  }

  clearAll(): void {
    for (const tabId of this.shown) this.clear(tabId);
  }
}
