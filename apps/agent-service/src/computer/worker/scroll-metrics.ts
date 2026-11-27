import type { JSHandle, Locator, Page } from 'playwright-core';
import {
  actionOptions,
  pw,
  readOptional,
  SCROLL_STEP_PX,
  settleRead,
  type Evidence,
} from './actions.js';
import { pause, throwIfCancelled, WorkerError, type Operation } from './operations.js';
import { locatorFor, type Origins, type Pages } from './pages.js';
import { truncate } from './text.js';

/** Measured browser scroll (`scroll` `measure: true`): read-only Hz calibration, axis-specific container tracking, paced CDP wheel ticks, and handle-scoped telemetry with bounded teardown. */
const WHEEL = { px: 45, ms: 16, maxTicks: 60, maxMs: 2_500 };

export interface MeasureScrollInput {
  pageId: string;
  ref?: string | undefined;
  observationVersion?: number | undefined;
  direction: 'up' | 'down' | 'left' | 'right';
  amount: number;
  allowedOrigins?: Origins;
}

type Box = Record<'x' | 'y' | 'width' | 'height', number>;
type HitPoint = { x: number; y: number; vertical: boolean };
type ScrollState = Record<'x' | 'y' | 'maxX' | 'maxY', number>;
type ViewportState = ScrollState & Record<'vw' | 'vh', number> & { visibility: string };
type PerfEntry = Partial<Record<'duration' | 'value', number>> & { hadRecentInput?: boolean };
type Telemetry = Record<'durationMs' | 'cls', number> &
  Record<'deltas' | 'longTasks', number[]> & { throttled: boolean; win: ViewportState };
type Style = Record<'overflowX' | 'overflowY', string>;
type ScrollView = { top: unknown; getComputedStyle(e: DomNode): Style };
type DomDoc = {
  visibilityState?: string;
  scrollingElement: DomNode | null;
  defaultView?: ScrollView | null;
  elementFromPoint(x: number, y: number): DomNode | null;
};
type DomNode = Record<
  'scrollLeft' | 'scrollTop' | 'scrollWidth' | 'scrollHeight' | 'clientWidth' | 'clientHeight',
  number
> & {
  parentElement: DomNode | null;
  shadowRoot?: { elementFromPoint?(x: number, y: number): DomNode | null } | null;
  getRootNode?(): { host?: DomNode | null } | null;
  ownerDocument: DomDoc | null;
};
type PerfObs = { observe(o: object): void; takeRecords?(): PerfEntry[]; disconnect(): void };
/** Minimal browser globals for `page.evaluate` (worker compiles without DOM lib). */
type BrowserGlobal = Record<'scrollX' | 'scrollY' | 'innerWidth' | 'innerHeight', number> &
  Record<'cancelAnimationFrame' | 'clearTimeout', (id: number) => void> & {
    document: DomDoc;
    performance: { now(): number };
    requestAnimationFrame(cb: (ts: number) => void): number;
    setTimeout(cb: () => void, ms: number): number;
    PerformanceObserver?: {
      new (cb: (l: { getEntries(): PerfEntry[] }) => void): PerfObs;
      supportedEntryTypes?: readonly string[];
    };
  };

async function bounded(work: Promise<unknown>, ms = 500): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((r) => {
    timer = setTimeout(r, ms);
    timer.unref();
  });
  try {
    await Promise.race([work.catch(() => undefined), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function readBox(op: Operation, locator: Locator): Promise<Box> {
  const box = await pw(op, locator.boundingBox(actionOptions(op)));
  if (!box || box.width <= 0 || box.height <= 0)
    throw new WorkerError('targetChanged', 'The target element has no visible box to scroll.');
  return box;
}

/** Self-contained in-page helper: nearest ancestor scrollable along the requested axis. */
function resolveScrollable(target: DomNode | HitPoint, vertical?: boolean): DomNode | null {
  let cur: DomNode | null = 'scrollTop' in target ? target : null;
  const vert = 'scrollTop' in target ? Boolean(vertical) : target.vertical;
  if (!('scrollTop' in target)) {
    cur = (globalThis as unknown as BrowserGlobal).document.elementFromPoint(target.x, target.y);
    while (cur?.shadowRoot?.elementFromPoint) {
      const inner = cur.shadowRoot.elementFromPoint(target.x, target.y);
      if (!inner || inner === cur) break;
      cur = inner;
    }
  }
  while (cur) {
    const [view, root] = [cur.ownerDocument?.defaultView, cur.ownerDocument?.scrollingElement];
    if (cur === root && view === view?.top) break;
    const ov = view?.getComputedStyle(cur)[vert ? 'overflowY' : 'overflowX'];
    const ok =
      cur === root ? ov !== 'hidden' && ov !== 'clip' : /^(auto|scroll|overlay)$/.test(ov ?? '');
    if (ok && (vert ? cur.scrollHeight - cur.clientHeight : cur.scrollWidth - cur.clientWidth) > 1)
      return cur;
    const next = cur.parentElement ?? cur.getRootNode?.()?.host ?? null;
    cur = next === cur ? null : next;
  }
  return null;
}

function readContainer(op: Operation, handle: JSHandle<DomNode | null>) {
  const p = handle.evaluate((n): ScrollState | null => {
    if (!n) return null;
    const maxX = Math.max(0, n.scrollWidth - n.clientWidth);
    const maxY = Math.max(0, n.scrollHeight - n.clientHeight);
    return { x: n.scrollLeft, y: n.scrollTop, maxX, maxY };
  });
  return pw(op, p);
}

/** Handle-scoped in-page recorder: viewport snapshot, read-only Hz calibration, rAF/LT/CLS. */
function createRecorder(op: Operation, page: Page) {
  const handle = page.evaluateHandle(() => {
    const g = globalThis as unknown as BrowserGlobal;
    const deltas: number[] = [];
    const longTasks: number[] = [];
    const teardown: (() => void)[] = [];
    let cls = 0;
    let startedAt = 0;
    let stopped = false;
    let throttled = false;
    let rafId = 0;
    let cancelWait: (() => void) | undefined;
    const vis = () => g.document.visibilityState === 'visible';
    const quiet = (fn: () => void) => {
      try {
        fn();
      } catch {
        // Ignore teardown or unsupported observer errors.
      }
    };
    const viewport = (): ViewportState => {
      const root = g.document.scrollingElement;
      const [vw, vh] = [Math.max(1, g.innerWidth), Math.max(1, g.innerHeight)];
      const maxX = Math.max(0, (root?.scrollWidth ?? 0) - vw);
      const maxY = Math.max(0, (root?.scrollHeight ?? 0) - vh);
      const visibility = String(g.document.visibilityState ?? 'visible');
      return { x: g.scrollX, y: g.scrollY, maxX, maxY, vw, vh, visibility };
    };
    const waitRaf = (count: number, capMs: number, onDt?: (dt: number) => void) =>
      new Promise<void>((resolve) => {
        if (stopped) return resolve();
        let [left, id] = [count, 0];
        let last: number | null = null;
        const end = () => {
          cancelWait = undefined;
          g.cancelAnimationFrame(id);
          g.clearTimeout(t);
          resolve();
        };
        cancelWait = end;
        const t = g.setTimeout(end, capMs);
        if (!vis()) return;
        const step = (ts: number) => {
          if (stopped) return end();
          if (last !== null && ts > last) {
            onDt?.(ts - last);
            left -= 1;
          }
          last = ts;
          if (left <= 0 || !vis()) end();
          else id = g.requestAnimationFrame(step);
        };
        id = g.requestAnimationFrame(step);
      });
    const stop = () => {
      if (stopped) return;
      stopped = true;
      g.cancelAnimationFrame(rafId);
      cancelWait?.();
      for (const fn of teardown.splice(0)) quiet(fn);
    };
    const calibrate = async () => {
      const idle: number[] = [];
      if (vis()) await waitRaf(10, 400, (dt) => idle.push(dt));
      return { idle, win: viewport() };
    };
    const start = () => {
      if (stopped) return;
      const Ctor = g.PerformanceObserver;
      const types = Array.isArray(Ctor?.supportedEntryTypes) ? Ctor.supportedEntryTypes : [];
      for (const type of ['longtask', 'layout-shift']) {
        if (typeof Ctor !== 'function' || !types.includes(type)) continue;
        const drain = (entries: PerfEntry[]) => {
          for (const e of entries) {
            if (type === 'longtask' && Number.isFinite(e.duration) && longTasks.length < 600)
              longTasks.push(e.duration as number);
            else if (type === 'layout-shift' && !e.hadRecentInput && Number.isFinite(e.value))
              cls += e.value as number;
          }
        };
        quiet(() => {
          const obs = new Ctor((list) => drain(list.getEntries()));
          obs.observe({ type, buffered: false });
          teardown.push(() => {
            drain(obs.takeRecords?.() ?? []);
            obs.disconnect();
          });
        });
      }
      startedAt = g.performance.now();
      let last: number | null = null;
      const tick = (ts: number) => {
        if (stopped) return;
        if (!vis()) throttled = true;
        if (last !== null && ts > last && deltas.length < 600) deltas.push(ts - last);
        last = ts;
        rafId = g.requestAnimationFrame(tick);
      };
      if (vis()) rafId = g.requestAnimationFrame(tick);
      else throttled = true;
    };
    const finish = async (): Promise<Telemetry> => {
      await waitRaf(4, vis() ? 250 : 60);
      const [durationMs, win] = [Math.max(0, g.performance.now() - startedAt), viewport()];
      stop();
      return { deltas, durationMs, longTasks, cls, throttled: throttled || !vis(), win };
    };
    return { viewport, calibrate, start, finish, stop };
  });
  return pw(op, handle);
}

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const sum = (xs: readonly number[]) => xs.reduce((s, d) => s + d, 0);
const posNums = (xs: readonly number[]) => xs.filter((d) => Number.isFinite(d) && d > 0);
const offAxis = (p: number, sz: number, lim: number) => p + sz <= 0 || p >= lim;
const needsReveal = (b: Box, vw: number, vh: number) =>
  offAxis(b.x, b.width, vw) || offAxis(b.y, b.height, vh);
const atBoundary = (s: ScrollState, vertical: boolean, positive: boolean) => {
  const [pos, max] = vertical ? [s.y, s.maxY] : [s.x, s.maxX];
  return positive ? max <= 0 || pos >= max - 2 : pos <= 2;
};
const aimCoord = (start: number, size: number, limit: number) => {
  const [lo, hi] = [Math.max(0, start), Math.min(limit, start + size)];
  return Math.max(0, Math.min(limit - 1, Math.round(hi > lo ? (lo + hi) / 2 : limit / 2)));
};
const percentile = (xs: readonly number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * p) - 1))] ?? 0;
};

export async function measureScroll(
  pages: Pages,
  op: Operation,
  input: MeasureScrollInput,
): Promise<Record<string, unknown>> {
  return pages.withPage(op, input.pageId, async (page) => {
    const element = await readOptional(pages, op, input, input.allowedOrigins, page);
    throwIfCancelled(op);
    const locator = element ? locatorFor(element) : undefined;
    let box = locator ? await readBox(op, locator) : null;
    const vertical = input.direction === 'up' || input.direction === 'down';
    const positive = input.direction === 'down' || input.direction === 'right';
    const requested = (positive ? 1 : -1) * input.amount * SCROLL_STEP_PX;
    const ticks = Math.min(WHEEL.maxTicks, Math.max(1, Math.ceil(Math.abs(requested) / WHEEL.px)));
    const recorder = await createRecorder(op, page);
    const call = <R>(p: Promise<R>) => pw(op, p);
    let container: JSHandle<DomNode | null> | undefined;
    let idle: number[];
    let beforeWin: ViewportState;
    let beforeEl: ScrollState | null = null;
    let afterEl: ScrollState | null = null;
    let sample: Telemetry;
    let finished = false;
    try {
      ({ idle, win: beforeWin } = await call(recorder.evaluate((r) => r.calibrate())));
      throwIfCancelled(op);
      if (locator && box && needsReveal(box, beforeWin.vw, beforeWin.vh)) {
        op.dispatched = true;
        await call(locator.scrollIntoViewIfNeeded(actionOptions(op)));
        box = await readBox(op, locator);
        beforeWin = await call(recorder.evaluate((r) => r.viewport()));
      }
      const aimX = box ? aimCoord(box.x, box.width, beforeWin.vw) : Math.round(beforeWin.vw / 2);
      const aimY = box ? aimCoord(box.y, box.height, beforeWin.vh) : Math.round(beforeWin.vh / 2);
      container = await call(
        locator
          ? locator.evaluateHandle(resolveScrollable, vertical, actionOptions(op))
          : page.evaluateHandle(resolveScrollable, { x: aimX, y: aimY, vertical }),
      );
      beforeEl = await readContainer(op, container);
      await call(recorder.evaluate((r) => r.start()));
      throwIfCancelled(op);
      op.dispatched = true;
      await call(page.mouse.move(aimX, aimY));
      const started = performance.now();
      let emitted = 0;
      for (let i = 1; i <= ticks; i += 1) {
        throwIfCancelled(op);
        const tickStart = performance.now();
        if (tickStart - started >= WHEEL.maxMs) break;
        const delta = Math.round((requested * i) / ticks) - emitted;
        emitted += delta;
        await call(page.mouse.wheel(vertical ? 0 : delta, vertical ? delta : 0));
        const now = performance.now();
        const sleepMs = Math.min(WHEEL.ms - (now - tickStart), WHEEL.maxMs - (now - started));
        if (i < ticks && sleepMs > 1) await pause(op, sleepMs);
      }
      sample = await call(recorder.evaluate((r) => r.finish()));
      finished = true;
      afterEl = beforeEl ? await readContainer(op, container).catch(() => beforeEl) : null;
    } finally {
      if (!finished) await bounded(recorder.evaluate((r) => r.stop()));
      await Promise.all([bounded(recorder.dispose()), container && bounded(container.dispose())]);
    }
    await settleRead(pages, op, input.pageId, page, input.allowedOrigins);
    const afterWin = sample.win;
    const axis = (a: ScrollState, b: ScrollState) => (vertical ? b.y - a.y : b.x - a.x);
    const winMoved = axis(beforeWin, afterWin);
    const elMoved = beforeEl && afterEl ? axis(beforeEl, afterEl) : 0;
    const tracked =
      beforeEl &&
      afterEl &&
      (Math.abs(elMoved) > 0
        ? Math.abs(elMoved) >= Math.abs(winMoved)
        : winMoved === 0 &&
          ((vertical ? afterWin.maxY : afterWin.maxX) <= 0 ||
            atBoundary(afterEl, vertical, positive)))
        ? { before: beforeEl, after: afterEl, scope: 'element' as const }
        : { before: beforeWin, after: afterWin, scope: 'window' as const };
    const { before, after, scope } = tracked;
    const bg = beforeWin.visibility !== 'visible' || sample.throttled;
    const med = idle.length >= 3 ? percentile(idle, 0.5) : 0;
    const hz = med >= 1000 / 240 && med <= 1000 / 24 ? Math.round(1000 / med) : null;
    const budgetMs = hz === null ? 1000 / 60 : 1000 / hz;
    const [deltas, longTasks] = [posNums(sample.deltas), posNums(sample.longTasks)];
    const frameMs = sum(deltas);
    const avgFps = frameMs > 0 ? round((deltas.length * 1000) / frameMs) : 0;
    const over = (k: number) => deltas.filter((d) => d > budgetMs * k).length;
    const ltMax = Math.round(longTasks.reduce((m, d) => (d > m ? d : m), 0));
    const move = `${scope} scroll ${Math.round(before.x)},${Math.round(before.y)} -> ${Math.round(after.x)},${Math.round(after.y)} (moved ${Math.round(axis(before, after))}px / requested ${requested}px, boundary=${atBoundary(after, vertical, positive) ? 'reached' : 'no'}, visibility=${afterWin.visibility}${bg ? '; background tab throttles requestAnimationFrame' : ''})`;
    const metrics = `frames=${deltas.length} duration=${Math.round(sample.durationMs)}ms avgFps=${avgFps} estHz=${hz ?? 'uncalibrated'} (budget=${round(budgetMs)}ms) frameMs p50=${round(percentile(deltas, 0.5))} p95=${round(percentile(deltas, 0.95))} max=${round(percentile(deltas, 1))} dropped(>1.5x)=${over(1.5)} severe(>2x)=${over(2)} longTasks=${longTasks.length} (total=${Math.round(sum(longTasks))}ms max=${ltMax}ms) cls=${round(sample.cls, 4)}`;
    return {
      evidence: [move, metrics].map((s): Evidence => ({ kind: 'text', summary: truncate(s, 500) })),
    };
  });
}
