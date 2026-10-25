import { setTimeout as pause } from 'node:timers/promises';
import type { Frame, Page } from 'playwright-core';
import { throwIfCancelled, untilCancelled, WorkerError, type Operation } from './operations.js';
import { originOf, type Pages } from './pages.js';

interface PreviewFrame {
  sequence: number;
  capturedAt: number;
  /** Replaced with base64 on the first read; repeated reads do not serialize the JPEG again. */
  data: Buffer | string;
}
interface Preview {
  id: string;
  page: Page;
  ancestors: Page[];
  origins: readonly string[];
  expectedUrl: string;
  sequence: number;
  latest: PreviewFrame | undefined;
  nextFrameAt: number;
  pacing: { promise: Promise<void>; release: () => void } | undefined;
  expires: NodeJS.Timeout;
  closed: boolean;
  starting: Promise<unknown> | undefined;
  stopping: Promise<void> | undefined;
  onClose: () => void;
  onNavigation: (frame: Frame) => void;
}

const FRAME_INTERVAL_MS = 1_000 / 30;

/** One bounded latest JPEG per viewer. Preview never touches element versions or text baselines. */
export class Previews {
  private readonly active = new Map<string, Preview>();
  private readonly stopped = new Set<string>();
  constructor(private readonly pages: Pages) {}

  async start(
    op: Operation,
    input: {
      previewId: string;
      pageId: string;
      boundPageId: string;
      expectedUrl: string;
      allowedOrigins: string[];
    },
  ): Promise<Record<string, unknown>> {
    return this.pages.withPage(op, input.boundPageId, async (bound) =>
      this.pages.withPage(op, input.pageId, async (page) => {
        throwIfCancelled(op);
        if (this.active.size >= 4 || [...this.active.values()].some((entry) => entry.page === page))
          throw new WorkerError(
            'unsupported',
            'This page already has a preview, or the preview limit was reached.',
          );
        if (
          !input.allowedOrigins.includes(originOf(page.url())) ||
          page.url() !== input.expectedUrl
        )
          throw new WorkerError('targetChanged', 'The preview page left the observed target.');
        const ancestors: Page[] = [];
        let parent = page;
        while (parent !== bound && ancestors.length < 16) {
          const opener = await parent.opener();
          if (!opener || ancestors.includes(opener)) break;
          ancestors.push(opener);
          parent = opener;
        }
        if (
          parent !== bound ||
          ancestors.some((ancestor) => !input.allowedOrigins.includes(originOf(ancestor.url())))
        )
          throw new WorkerError(
            'targetChanged',
            'The preview page is no longer owned by the bound page.',
          );
        throwIfCancelled(op);
        if (this.active.size >= 4 || [...this.active.values()].some((entry) => entry.page === page))
          throw new WorkerError('unsupported', 'The preview slot was claimed by another viewer.');
        const id = input.previewId;
        if (this.stopped.has(id) || this.active.has(id))
          throw new WorkerError('cancelled', 'The preview lease already ended or was used.');
        const entry: Preview = {
          id,
          page,
          ancestors,
          origins: input.allowedOrigins,
          expectedUrl: input.expectedUrl,
          sequence: 0,
          latest: undefined,
          nextFrameAt: 0,
          pacing: undefined,
          closed: false,
          starting: undefined,
          stopping: undefined,
          expires: setTimeout(() => {
            void this.stop(id);
          }, 5_000),
          onClose: () => {
            void this.stop(id);
          },
          onNavigation: (frame) => {
            if (
              frame === page.mainFrame() ||
              ancestors.some((ancestor) => frame === ancestor.mainFrame())
            )
              void this.stop(id);
          },
        };
        entry.expires.unref();
        this.active.set(id, entry);
        for (const ancestor of ancestors) {
          ancestor.on('close', entry.onClose);
          ancestor.on('framenavigated', entry.onNavigation);
        }
        page.on('close', entry.onClose);
        page.on('crash', entry.onClose);
        page.on('framenavigated', entry.onNavigation);
        page.context().browser()?.on('disconnected', entry.onClose);
        try {
          entry.starting = page.screencast.start({
            size: { width: 1280, height: 1280 },
            quality: 60,
            onFrame: ({ data, timestamp }) => this.receive(entry, data, timestamp),
          });
          await untilCancelled(op, entry.starting);
          throwIfCancelled(op);
          if (!this.healthy(entry))
            throw new WorkerError('targetChanged', 'The preview page changed while starting.');
          return { previewId: id };
        } catch (error) {
          await this.stop(id);
          throw error;
        }
      }),
    );
  }

  read(id: string): Record<string, unknown> {
    const entry = this.active.get(id);
    if (!entry || !this.healthy(entry)) {
      void this.stop(id);
      throw new WorkerError('targetChanged', 'The preview ended or its page changed.');
    }
    entry.expires.refresh();
    const frame = entry.latest?.sequence === entry.sequence ? entry.latest : undefined;
    // A read is not a delivery acknowledgement: a cancelled reply must leave a static frame
    // available for retry. Cache only this newest revision's transport representation.
    if (frame && typeof frame.data !== 'string') frame.data = frame.data.toString('base64');
    return {
      previewId: id,
      ...(frame
        ? {
            frame: {
              sequence: frame.sequence,
              capturedAt: frame.capturedAt,
              base64: frame.data,
            },
          }
        : {}),
    };
  }

  async stop(id: string): Promise<void> {
    // A stop can overtake a pending start that has not found its page yet.
    this.stopped.add(id);
    if (this.stopped.size > 256) {
      const oldest = this.stopped.values().next().value;
      if (oldest !== undefined) this.stopped.delete(oldest);
    }
    const entry = this.active.get(id);
    if (!entry) return;
    if (entry.closed) return entry.stopping;
    entry.closed = true;
    entry.latest = undefined;
    entry.pacing?.release();
    clearTimeout(entry.expires);
    for (const ancestor of entry.ancestors) {
      ancestor.off('close', entry.onClose);
      ancestor.off('framenavigated', entry.onNavigation);
    }
    entry.page.off('close', entry.onClose);
    entry.page.off('crash', entry.onClose);
    entry.page.off('framenavigated', entry.onNavigation);
    entry.page.context().browser()?.off('disconnected', entry.onClose);
    entry.stopping = (async () => {
      await entry.starting?.catch(() => undefined);
      await entry.page.screencast.stop().catch(() => undefined);
      if (this.active.get(id) === entry) this.active.delete(id);
    })();
    // A browser that stopped answering must not hold worker shutdown or a cancelled open.
    // The pending stop still runs if start eventually resolves.
    await Promise.race([entry.stopping, pause(2_500, undefined, { ref: false })]);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.stop(id)));
  }

  private receive(entry: Preview, data: Buffer, timestamp: number): Promise<void> | undefined {
    if (!this.healthy(entry)) {
      void this.stop(entry.id);
      return;
    }
    if (data.length > 0 && data.length <= 1_048_576 && Number.isFinite(timestamp) && timestamp > 0)
      entry.latest = { sequence: entry.sequence + 1, capturedAt: timestamp, data };
    // Playwright can overlap callbacks when another screencast client is active. Retain only
    // the newest frame and share one acknowledgement gate; its final frame still publishes if
    // the page stops changing during this interval. This bounds our publications, not Chromium.
    if (entry.pacing) return entry.pacing.promise;
    const now = performance.now();
    if (now >= entry.nextFrameAt) {
      this.publish(entry, now);
      entry.nextFrameAt = now + FRAME_INTERVAL_MS;
    }
    return this.pace(entry);
  }

  private publish(entry: Preview, now: number): void {
    if (entry.latest && entry.latest.sequence > entry.sequence) {
      entry.sequence = entry.latest.sequence;
      entry.nextFrameAt = now + FRAME_INTERVAL_MS;
    }
  }

  private pace(entry: Preview): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    const release = (): void => {
      clearTimeout(timer);
      if (entry.pacing?.promise === promise) entry.pacing = undefined;
      resolve();
    };
    const due = (): void => {
      if (!this.healthy(entry)) {
        void this.stop(entry.id);
        return;
      }
      const remaining = entry.nextFrameAt - performance.now();
      if (remaining > 0) timer = setTimeout(due, Math.ceil(remaining)).unref();
      else {
        this.publish(entry, performance.now());
        release();
      }
    };
    let timer = setTimeout(due, Math.ceil(entry.nextFrameAt - performance.now())).unref();
    entry.pacing = { promise, release };
    return promise;
  }

  private healthy(entry: Preview): boolean {
    return (
      !entry.closed &&
      entry.ancestors.every(
        (ancestor) => !ancestor.isClosed() && entry.origins.includes(originOf(ancestor.url())),
      ) &&
      !entry.page.isClosed() &&
      entry.page.context().browser()?.isConnected() === true &&
      entry.page.url() === entry.expectedUrl &&
      entry.origins.includes(originOf(entry.page.url()))
    );
  }
}
