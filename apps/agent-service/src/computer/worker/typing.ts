import type { ElementHandle, JSHandle, Locator, Page } from 'playwright-core';
import {
  pause,
  throwIfCancelled,
  untilCancelled,
  WorkerError,
  type Operation,
} from './operations.js';

/** Host-generated TypingPace boundaries, in UTF-16 offsets, never an agent-controlled option. */
export interface TypingFeedback {
  chunks: { end: number; dueMs: number }[];
  highlight: boolean;
  reduceMotion: boolean;
  increaseContrast: boolean;
}

interface Field {
  readonly value?: string;
  readonly innerText: string;
  readonly isContentEditable: boolean;
  readonly isConnected: boolean;
  readonly type?: string;
  readonly ownerDocument: {
    readonly activeElement: unknown;
    readonly defaultView: {
      getComputedStyle(node: unknown): { backgroundColor: string; caretColor: string };
    } | null;
  };
  contains(node: unknown): boolean;
  animate(
    frames: Record<string, string>[],
    options: { duration: number; easing: string },
  ): Animation;
}
interface Animation {
  cancel(): void;
  readonly finished: Promise<unknown>;
}
const active = new WeakMap<Page, Set<JSHandle<Animation | null>>>();

/** Browser-native paint only: no text copies, page nodes, selection changes or keyboard events.
 * A form control exposes no glyph rectangles, so the wash covers its actual field. Its entire
 * value is newly filled. Colours and lifetime match the native InsertionTraceOverlay.
 */
async function highlight(page: Page, field: ElementHandle, options: TypingFeedback): Promise<void> {
  await clearTypingFeedback(page);
  const animation = await field.evaluateHandle((node: Field, settings) => {
    const view = node.ownerDocument.defaultView;
    if (!node.isConnected || !view || node.type === 'password') return null;
    const style = view.getComputedStyle(node);
    const wash = settings.increaseContrast ? 'rgba(255, 106, 61, 0.4)' : 'rgba(255, 106, 61, 0.3)';
    const first: Record<string, string> = { backgroundColor: wash };
    const last: Record<string, string> = { backgroundColor: style.backgroundColor };
    if (!settings.reduceMotion) {
      first.caretColor = 'rgb(255, 106, 61)';
      last.caretColor = style.caretColor;
    }
    return node.animate([first, last], { duration: 620, easing: 'cubic-bezier(0.2, 0.6, 0.3, 1)' });
  }, options);
  const handle = animation;
  if (await handle.evaluate((value) => value === null)) {
    await handle.dispose();
    return;
  }
  // The non-null animation belongs to this exact element and expires without changing styles.
  const entry = animation;
  const entries = active.get(page) ?? new Set<JSHandle<Animation | null>>();
  entries.add(entry);
  active.set(page, entries);
  void entry
    .evaluate((value) =>
      value?.finished.then(
        () => undefined,
        () => undefined,
      ),
    )
    .catch(() => undefined)
    .finally(() => {
      entries.delete(entry);
      void entry.dispose().catch(() => undefined);
    });
}

/** Machine observations exclude feedback; the person's live browser preview keeps it. */
export async function clearTypingFeedback(page: Page): Promise<void> {
  const entries = active.get(page);
  active.delete(page);
  await Promise.all(
    [...(entries ?? [])].map(async (entry) => {
      await entry.evaluate((animation) => animation?.cancel()).catch(() => undefined);
      await entry.dispose().catch(() => undefined);
    }),
  );
}

/** Fill semantics stay replacement, including line breaks. Every chunk is read back on the
 * same DOM node. Detachment, lost focus, transformed input or cancellation stops the remaining
 * chunks; the original operation retains dispatched=true and can never be retried as a refusal.
 */
export async function fillWithFeedback(
  page: Page,
  op: Operation,
  locator: Locator,
  text: string,
  feedback?: TypingFeedback,
): Promise<void> {
  if (!feedback || (!feedback.highlight && feedback.chunks.length <= 1)) {
    throwIfCancelled(op);
    op.dispatched = true;
    await untilCancelled(op, locator.fill(text, { timeout: 5_000 }));
    return;
  }
  const field = await untilCancelled(op, locator.elementHandle({ timeout: 5_000 }));
  if (!field) throw new WorkerError('targetChanged', 'The input field disappeared.');
  const cancelHighlight = () => {
    void clearTypingFeedback(page);
  };
  op.signal.addEventListener('abort', cancelHighlight, { once: true });
  let completed = false;
  try {
    const scheduled = feedback?.chunks ?? [];
    const valid =
      scheduled.every(
        (chunk, index) =>
          chunk.end > (scheduled[index - 1]?.end ?? 0) &&
          chunk.dueMs >= (scheduled[index - 1]?.dueMs ?? 0),
      ) && scheduled.at(-1)?.end === text.length;
    if (scheduled.length && !valid)
      throw new WorkerError('unsupported', 'Invalid host typing schedule.');
    const chunks =
      feedback?.reduceMotion || !scheduled.length ? [{ end: text.length, dueMs: 0 }] : scheduled;
    const started = performance.now();
    let previous: string | undefined;
    for (let index = 0; index < chunks.length; index += 1) {
      let chunk = chunks[index]!;
      await pause(op, Math.max(0, chunk.dueMs - (performance.now() - started)));
      // Slow fields skip overdue intermediate prefixes, keeping the Command time budget.
      while (index + 1 < chunks.length && chunks[index + 1]!.dueMs <= performance.now() - started)
        chunk = chunks[++index]!;
      throwIfCancelled(op);
      if (previous !== undefined) await verify(field, op, previous);
      op.dispatched = true;
      const value = text.slice(0, chunk.end);
      await untilCancelled(op, field.fill(value, { timeout: 5_000 }));
      if (chunks.length > 1) await verify(field, op, value);
      if (feedback?.highlight && text)
        await highlight(page, field, feedback).catch(() => undefined);
      previous = value;
    }
    completed = true;
  } finally {
    op.signal.removeEventListener('abort', cancelHighlight);
    if (!completed || op.signal.aborted) await clearTypingFeedback(page);
    await field.dispose().catch(() => undefined);
  }
}

async function verify(field: ElementHandle, op: Operation, expected: string): Promise<void> {
  const state = await untilCancelled(
    op,
    field.evaluate((node: Field) => ({
      value: node.isContentEditable ? node.innerText.replace(/\n$/, '') : (node.value ?? ''),
      connected: node.isConnected,
      focused:
        node === node.ownerDocument.activeElement ||
        node.contains(node.ownerDocument.activeElement),
    })),
  );
  if (!state.connected || !state.focused || state.value !== expected)
    throw new WorkerError(
      'targetChanged',
      'The input field changed during typing; no more text was sent.',
    );
}
