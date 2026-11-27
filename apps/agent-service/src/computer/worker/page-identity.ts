import type { Page } from 'playwright-core';
import type { BrowserChannel } from './connection.js';
import {
  classifyTargetDropCode,
  errorMessage,
  LogDeduper,
  sanitizeOrigin,
  workerLog,
} from './log.js';
import { whileActive, type Operation } from './operations.js';

export interface PageIdentity {
  targetId: string;
  openerId?: string;
}

/** Reads a page's CDP target id (and opener id, when present) without hanging past cancellation. */
export async function readPageIdentity(page: Page, op?: Operation): Promise<PageIdentity> {
  const pending = page.context().newCDPSession(page);
  const session = await whileActive(op, pending).catch((error: unknown) => {
    void pending.then(
      (created) => created.detach().catch(() => undefined),
      () => undefined,
    );
    throw error;
  });
  try {
    const { targetInfo } = await whileActive(op, session.send('Target.getTargetInfo'));
    return targetInfo.openerId === undefined
      ? { targetId: targetInfo.targetId }
      : { targetId: targetInfo.targetId, openerId: targetInfo.openerId };
  } finally {
    const detach = session.detach().catch(() => undefined);
    if (op?.signal.aborted !== true) await detach;
  }
}

function safePageUrl(page: Page): string | undefined {
  try {
    return page.url();
  } catch {
    return undefined;
  }
}

/**
 * Caches resolved page target identities per Playwright `Page` and deduplicates target-drop
 * warnings by `(targetKey, code)` across repeated listings.
 */
export class PageIdentityCache {
  private readonly ids = new WeakMap<Page, PageIdentity>();
  private readonly keys = new WeakMap<Page, number>();
  private readonly drops = new LogDeduper();
  private nextKey = 1;

  constructor(
    private readonly reader: (
      page: Page,
      op?: Operation,
    ) => Promise<PageIdentity> = readPageIdentity,
  ) {}

  async resolve(page: Page, op?: Operation): Promise<PageIdentity> {
    const known = this.ids.get(page);
    if (known !== undefined) return known;
    const id = await this.reader(page, op);
    this.ids.set(page, id);
    return id;
  }

  async tryResolve(
    page: Page,
    op: Operation | undefined,
    channel: BrowserChannel,
  ): Promise<PageIdentity | undefined> {
    try {
      return await whileActive(op, this.resolve(page, op));
    } catch (error) {
      if (op?.signal.aborted === true) throw error;
      const code = classifyTargetDropCode(error, page.isClosed());
      const rawUrl = safePageUrl(page);
      const origin = sanitizeOrigin(rawUrl);
      const targetKey = `${this.keyFor(page)}:${origin ?? 'unknown'}`;
      if (this.drops.shouldLog(targetKey, code)) {
        workerLog({
          level: 'warn',
          cat: 'target',
          code,
          channel,
          origin,
          msg: errorMessage(error),
        });
      }
      return undefined;
    }
  }

  resetDrops(): void {
    this.drops.clear();
  }

  private keyFor(page: Page): number {
    const existing = this.keys.get(page);
    if (existing !== undefined) return existing;
    const assigned = this.nextKey++;
    this.keys.set(page, assigned);
    return assigned;
  }
}
