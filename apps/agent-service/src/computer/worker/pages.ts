import { createHash, randomUUID } from 'node:crypto';
import type { Browser, Page } from 'playwright-core';
import { connectBrowser, type BrowserChannel } from './connection.js';
import type { Downloads } from './downloads.js';
import { workerLog } from './log.js';
import {
  orIfActive,
  throwIfCancelled,
  untilCancelled,
  whileActive,
  WorkerError,
  type Operation,
} from './operations.js';
import {
  locatorFor,
  originOf,
  refOf,
  type DocumentState,
  type Element,
  type Origins,
  type PageRead,
} from './page-elements.js';
import { PageIdentityCache, type PageIdentity } from './page-identity.js';
import { parseSnapshot } from './snapshot.js';

export {
  locatorFor,
  originOf,
  refOf,
  type DocumentState,
  type Element,
  type Origins,
  type PageRead,
};

/**
 * Exact page access over one playwright-core `connectOverCDP` connection per worker, with
 * Playwright's defaults on a managed profile (downloads accepted into the artifacts directory,
 * focus emulation; none in the person's own Chrome) except for JavaScript dialogs: Playwright
 * closes a dialog nobody listens for at once (dismissing `alert`/`confirm`/`prompt`, accepting
 * `beforeunload`), so the worker listens on every context and page and leaves each dialog open
 * for the person, as Chrome does without a client attached.
 * The worker connects only to the browser socket the host verified (connection.ts).
 * Playwright attaches to every page of the browser, so the worker itself
 * enforces "only the host-named page": a `pageId` is a CDP target id, mapped to a `Page` through
 * `Target.getTargetInfo` on a session of that page (which also gives `openerId`), and refused with
 * `notFound` before anything else when no attached page has it.
 *
 * Per page it tracks a `navigationGeneration`, bumped whenever the main document's URL or its
 * time origin (a new document) differs from the last read, and an `observationVersion`, bumped
 * whenever the listed elements' identity (generation, frames, roles, names) changes. Both are
 * worker-local integers starting at 1; a worker restart starts them again, which the host covers
 * with its engine generation. Element refs are `<generation>.<index>` into the last read; frames
 * outside the binding's allowed origins are never read or driven.
 */

const BASELINE_TEXT_LIMIT = 200_000;
const BASELINES_PER_PAGE = 8;
const PAGE_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Opener links followed when looking for the run directory of a popup's download. */
const OPENER_HOPS = 8;
const DOCUMENT_EXPRESSION =
  '({ url: String(location.href), title: String(document.title), origin: Number(performance.timeOrigin) })';
const TEXT_EXPRESSION = "document.body ? String(document.body.innerText) : ''";
/** Read timeout for snapshots and element evaluations. */
export const READ_TIMEOUT_MS = 5_000;

interface PageState {
  navigationKey: string;
  navigationGeneration: number;
  identityHash: string;
  observationVersion: number;
  baselines: Map<string, string>;
}

/**
 * A dialog listener that does nothing: with a listener registered Playwright neither dismisses nor
 * accepts the dialog (its client closes one only when no `dialog` listener answered), so it stays
 * open until the person answers it. Reads of that page wait meanwhile, as they did before.
 */
function leaveOpen(): void {}

export class Pages {
  private browser: Promise<Browser> | undefined;
  private closing = false;
  private readonly identities = new PageIdentityCache();
  private readonly states = new Map<string, PageState>();

  constructor(
    private readonly socket: string | undefined,
    readonly downloads: Downloads,
    /** Which browser the socket is (connection.ts): a managed profile or the person's Chrome. */
    readonly channel: BrowserChannel,
  ) {}

  connect(): Promise<Browser> {
    const { socket } = this;
    if (socket === undefined)
      throw new WorkerError('engineFailed', 'ATD_CDP_WS is missing or not a local browser socket.');
    this.closing = false;
    this.browser ??= (async () => {
      const browser = await connectBrowser(socket, this.channel, this.downloads.staging());
      for (const context of browser.contexts()) {
        // The context listener also covers a page between its creation and `track`.
        context.on('dialog', leaveOpen);
        for (const page of context.pages()) this.track(page);
        context.on('page', (page) => this.track(page));
      }
      browser.on('disconnected', () => {
        this.browser = undefined;
        this.identities.resetDrops();
        if (!this.closing) {
          workerLog({
            level: 'warn',
            cat: 'cdp',
            code: 'browser_disconnected',
            channel: this.channel,
            msg: 'Browser CDP connection disconnected unexpectedly.',
          });
        }
      });
      return browser;
    })().catch((error: unknown) => {
      this.browser = undefined;
      throw error;
    });
    return this.browser;
  }

  private track(page: Page): void {
    page.on('dialog', leaveOpen);
    page.on('download', (download) => {
      const origin = page.url();
      void this.openerChain(page)
        .catch(() => [])
        .then((chain) => this.downloads.handle(download, chain, origin));
    });
  }

  /** The page's target id, then its opener's, and so on (bounded). */
  private async openerChain(page: Page): Promise<string[]> {
    const openers = new Map(
      (await this.attached()).map((entry) => [entry.targetId, entry.openerId] as const),
    );
    const chain = [(await this.identities.resolve(page)).targetId];
    for (let hop = 0; hop < OPENER_HOPS; hop += 1) {
      const opener = openers.get(chain[chain.length - 1] ?? '');
      if (opener === undefined || chain.includes(opener)) break;
      chain.push(opener);
    }
    return chain;
  }

  private async attached(op?: Operation): Promise<({ page: Page } & PageIdentity)[]> {
    const browser = await whileActive(op, this.connect());
    const result: ({ page: Page } & PageIdentity)[] = [];
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        if (op !== undefined) throwIfCancelled(op);
        if (page.isClosed()) continue;
        const id = await this.identities.tryResolve(page, op, this.channel);
        if (id !== undefined) result.push({ page, ...id });
      }
    return result;
  }

  /** The page targets of the browser, with the page that opened each, when Chrome knows it. */
  async list(
    op: Operation,
  ): Promise<{ pageId: string; url: string; title: string; openerId?: string }[]> {
    const pages = await this.attached(op);
    const ids = new Set(pages.map((entry) => entry.targetId));
    for (const pageId of this.states.keys()) if (!ids.has(pageId)) this.states.delete(pageId);
    this.downloads.keepOnly(ids);
    return Promise.all(
      pages.map(async ({ page, targetId, openerId }) => {
        const title = await orIfActive(op, page.title(), '');
        const entry = { pageId: targetId, url: page.url(), title };
        return openerId === undefined ? entry : { ...entry, openerId };
      }),
    );
  }

  /** Runs `work` on exactly `pageId`; an unknown page is `notFound` before anything is sent. */
  async withPage<T>(op: Operation, pageId: string, work: (page: Page) => Promise<T>): Promise<T> {
    if (!PAGE_ID.test(pageId)) throw new WorkerError('notFound', 'The page id is malformed.');
    const pages = await this.attached(op).catch((error: unknown) => {
      if (error instanceof WorkerError) throw error;
      throw new WorkerError('engineFailed', 'Could not connect to the browser.');
    });
    const found = pages.find((entry) => entry.targetId === pageId);
    if (found === undefined)
      throw new WorkerError('notFound', `No page ${pageId} on this browser profile.`);
    return work(found.page);
  }

  /** Reads the main document and updates the page's navigation generation. */
  async readDocument(op: Operation, pageId: string, page: Page): Promise<DocumentState> {
    const raw: unknown = await untilCancelled(op, page.evaluate(DOCUMENT_EXPRESSION));
    const fields = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const { url, title, origin } = fields;
    if (typeof url !== 'string' || typeof title !== 'string' || typeof origin !== 'number')
      throw new WorkerError('engineFailed', 'The page did not report its document.');
    const navigationKey = `${String(origin)} ${url}`;
    const state = this.states.get(pageId);
    if (state === undefined)
      this.states.set(pageId, {
        navigationKey,
        navigationGeneration: 1,
        identityHash: '',
        observationVersion: 0,
        baselines: new Map(),
      });
    else if (state.navigationKey !== navigationKey) {
      state.navigationKey = navigationKey;
      state.navigationGeneration += 1;
    }
    const navigationGeneration = this.states.get(pageId)?.navigationGeneration ?? 1;
    op.navigationGeneration = navigationGeneration;
    return { url, title, navigationGeneration };
  }

  /**
   * The document plus one `ariaSnapshot()` per frame whose origin is allowed. Frames outside
   * the origins are skipped whole; a frame between documents has no snapshot yet and is skipped.
   */
  async read(op: Operation, pageId: string, page: Page, origins: Origins): Promise<PageRead> {
    const document = await this.readDocument(op, pageId, page);
    const allowed = new Set(origins ?? [originOf(page.mainFrame().url())]);
    const elements: Element[] = [];
    const identity = createHash('sha256').update(String(document.navigationGeneration));
    for (const frame of page.frames()) {
      const origin = originOf(frame.url());
      if (!allowed.has(origin) || frame.isDetached()) continue;
      let yaml: string;
      try {
        const snapshot = frame.locator(':root').ariaSnapshot({ timeout: READ_TIMEOUT_MS });
        yaml = await untilCancelled(op, snapshot);
      } catch (error) {
        if (op.signal.aborted) throw error;
        continue;
      }
      const byRole = new Map<string, number>();
      const byName = new Map<string, number>();
      identity.update(`#${frame.url()}`);
      for (const entry of parseSnapshot(yaml)) {
        const nameKey = `${entry.role}\u0000${entry.name}`;
        const nth = entry.name === '' ? (byRole.get(entry.role) ?? 0) : (byName.get(nameKey) ?? 0);
        byRole.set(entry.role, (byRole.get(entry.role) ?? 0) + 1);
        byName.set(nameKey, (byName.get(nameKey) ?? 0) + 1);
        elements.push({ ...entry, frame, origin, nth });
        identity.update(`|${entry.role}:${entry.name}`);
      }
    }
    const hash = identity.digest('hex');
    const state = this.states.get(pageId);
    if (state === undefined) throw new WorkerError('engineFailed', 'The page state was lost.');
    if (state.identityHash !== hash) {
      state.identityHash = hash;
      state.observationVersion += 1;
    }
    op.observationVersion = state.observationVersion;
    return { ...document, observationVersion: state.observationVersion, elements };
  }

  /** The page's visible text (`innerText`), bounded. */
  async text(op: Operation, page: Page): Promise<string> {
    const value: unknown = await untilCancelled(op, page.evaluate(TEXT_EXPRESSION));
    if (typeof value !== 'string')
      throw new WorkerError('engineFailed', 'The page did not report its text.');
    return value.slice(0, BASELINE_TEXT_LIMIT);
  }

  /** Records the page's current text as a `newText` baseline and returns its id. */
  async captureBaseline(op: Operation, pageId: string, page: Page): Promise<string> {
    const text = await this.text(op, page);
    const state = this.states.get(pageId);
    if (state === undefined) throw new WorkerError('engineFailed', 'The page state was lost.');
    const baselineId = `b-${randomUUID()}`;
    state.baselines.set(baselineId, text);
    while (state.baselines.size > BASELINES_PER_PAGE) {
      const oldest = state.baselines.keys().next();
      if (oldest.done === true) break;
      state.baselines.delete(oldest.value);
    }
    return baselineId;
  }

  /** A baseline's text, or `staleObservation` when this worker no longer has it. */
  baseline(pageId: string, baselineId: string): string {
    const text = this.states.get(pageId)?.baselines.get(baselineId);
    if (text === undefined)
      throw new WorkerError(
        'staleObservation',
        'The baseline is unknown or expired; observe again.',
      );
    return text;
  }

  /**
   * The element a ref names in `read`: another navigation generation, a missing index or a
   * detached frame is `targetChanged`; a frame that now shows a disallowed origin is refused.
   */
  element(read: PageRead, ref: string, origins: Origins): Element {
    const match = /^(\d{1,9})\.(\d{1,15})$/.exec(ref);
    if (match === null) throw new WorkerError('notFound', `'${ref}' is not an element ref.`);
    if (Number(match[1]) !== read.navigationGeneration)
      throw new WorkerError('targetChanged', 'The page navigated since this ref was observed.');
    const element = read.elements[Number(match[2]) - 1];
    if (element === undefined)
      throw new WorkerError('targetChanged', 'The element is no longer on the page.');
    if (element.frame.isDetached()) throw new WorkerError('targetChanged', 'The frame is gone.');
    const origin = originOf(element.frame.url());
    if (origin !== element.origin || (origins !== undefined && !origins.includes(origin)))
      throw new WorkerError('unsupported', 'The frame is outside the allowed origins.');
    return element;
  }

  /** Disconnects (over CDP Playwright only detaches, so Chrome and its pages stay) and removes this worker's download staging. */
  async closeAll(): Promise<void> {
    this.closing = true;
    const browser = await this.browser?.catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await this.downloads.removeStaging();
  }
}
