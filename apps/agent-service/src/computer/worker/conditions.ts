import type { Page } from 'playwright-core';
import { pause, untilCancelled, WorkerError, type Operation } from './operations.js';
import { locatorFor, READ_TIMEOUT_MS, type Origins, type Pages } from './pages.js';
import type { WaitCondition } from './schemas.js';
import { truncate } from './text.js';

/**
 * `wait`: polls one condition with adapter-owned reads (the accessibility tree, the document URL
 * and `innerText`) until it holds, the deadline passes (`timeout`) or the operation is cancelled.
 * No caller-supplied script runs in the page; a `newText` pattern is a regular expression the
 * worker evaluates in Node over the bounded page text. A wait only reads, so it never dispatches.
 */

/** Delay between polls. */
const POLL_INTERVAL_MS = 250;

/** A `newText` regular expression, compiled once; an invalid one is `unsupported`. */
function compilePattern(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'gu');
  } catch {
    throw new WorkerError('unsupported', 'The newText pattern is not a valid regular expression.');
  }
}

/** The pieces of `text` a `newText` condition compares: pattern matches, or non-empty lines. */
function pieces(text: string, pattern: RegExp | undefined): string[] {
  if (pattern === undefined)
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  return [...text.matchAll(pattern)].map((match) => match[0]).filter((piece) => piece !== '');
}

type Check =
  | { satisfied: false }
  | { satisfied: true; evidence: { kind: 'text' | 'url' | 'value'; summary: string } };

/** Evaluates `condition` once against the page's current state. */
async function check(
  pages: Pages,
  op: Operation,
  pageId: string,
  page: Page,
  condition: WaitCondition,
  newText: { baseline: Set<string>; pattern: RegExp | undefined } | undefined,
  origins: Origins,
): Promise<Check> {
  switch (condition.kind) {
    case 'enabled': {
      const read = await pages.read(op, pageId, page, origins);
      const element = pages.element(read, condition.ref, origins);
      return element.disabled
        ? { satisfied: false }
        : { satisfied: true, evidence: { kind: 'text', summary: `${element.role} enabled` } };
    }
    case 'valueEquals': {
      const read = await pages.read(op, pageId, page, origins);
      const element = pages.element(read, condition.ref, origins);
      return (element.value ?? '') === condition.text
        ? { satisfied: true, evidence: { kind: 'value', summary: `${element.role} value matches` } }
        : { satisfied: false };
    }
    case 'textAppears': {
      await pages.readDocument(op, pageId, page);
      return (await pages.text(op, page)).includes(condition.text)
        ? { satisfied: true, evidence: { kind: 'text', summary: truncate(condition.text, 500) } }
        : { satisfied: false };
    }
    case 'urlMatches': {
      const { url } = await pages.readDocument(op, pageId, page);
      return url.startsWith(condition.pattern)
        ? { satisfied: true, evidence: { kind: 'url', summary: truncate(url, 500) } }
        : { satisfied: false };
    }
    case 'newText': {
      if (newText === undefined) throw new WorkerError('engineFailed', 'The baseline is missing.');
      let text: string;
      if (condition.ref === undefined) {
        await pages.readDocument(op, pageId, page);
        text = await pages.text(op, page);
      } else {
        const read = await pages.read(op, pageId, page, origins);
        const locator = locatorFor(pages.element(read, condition.ref, origins));
        const inner = await untilCancelled(op, locator.innerText({ timeout: READ_TIMEOUT_MS }));
        text = inner.replace(/\s+/g, ' ').trim();
      }
      const fresh = pieces(text, newText.pattern).find((piece) => !newText.baseline.has(piece));
      return fresh === undefined
        ? { satisfied: false }
        : { satisfied: true, evidence: { kind: 'text', summary: truncate(fresh, 500) } };
    }
  }
}

export async function wait(
  pages: Pages,
  op: Operation,
  input: { pageId: string; condition: WaitCondition; timeoutMs: number; allowedOrigins?: Origins },
): Promise<Record<string, unknown>> {
  const { condition } = input;
  const deadline = Date.now() + input.timeoutMs;
  let newText: { baseline: Set<string>; pattern: RegExp | undefined } | undefined;
  if (condition.kind === 'newText') {
    const pattern = condition.pattern === undefined ? undefined : compilePattern(condition.pattern);
    const baseline = pages.baseline(input.pageId, condition.baselineId);
    newText = { baseline: new Set(pieces(baseline, pattern)), pattern };
  }
  const origins = input.allowedOrigins;
  return pages.withPage(op, input.pageId, async (page) => {
    for (;;) {
      let result: Check = { satisfied: false };
      try {
        result = await check(pages, op, input.pageId, page, condition, newText, origins);
      } catch (error) {
        // A read can fail while the page is between documents; keep polling unless the failure
        // is a decision (a WorkerError such as targetChanged) or the page is gone.
        if (error instanceof WorkerError || page.isClosed()) throw error;
      }
      if (result.satisfied) {
        if (op.observationVersion === undefined)
          await pages.read(op, input.pageId, page, origins).catch(() => undefined);
        return { satisfied: true, evidence: [result.evidence] };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new WorkerError(
          'timeout',
          `The ${condition.kind} condition did not hold within ${String(input.timeoutMs)} ms.`,
        );
      await pause(op, Math.min(POLL_INTERVAL_MS, remaining));
    }
  });
}
