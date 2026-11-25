import type { Page } from 'playwright-core';
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
