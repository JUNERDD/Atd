import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { actionOptions, pw, readCurrent, readOptional, settleRead } from './actions.js';
import { throwIfCancelled, WorkerError, type Operation } from './operations.js';
import { locatorFor, READ_TIMEOUT_MS, type Origins, type Pages } from './pages.js';
import { SELECT_ROLES } from './text.js';

/**
 * The browser's `key`, `select` and `upload` tools (contract spec v1.3 B2). Like the other
 * page-changing tools they check what they can before `op.dispatched` flips and never retry.
 * `upload` sets only regular files of at most 50 MB inside the host's upload root
 * (`ATD_UPLOAD_ROOT`, the service's resource store `<dataDir>/resources`), checked again here
 * after the host checked them.
 */

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** The DOM members `select` and `upload` read in the page. */
interface ChoiceNode {
  readonly tagName: string;
  readonly type?: string;
  readonly options?: ArrayLike<{ readonly label: string }>;
}

/** `key`: presses a chord on the focused element, or on an element of the observation. */
export async function key(
  pages: Pages,
  op: Operation,
  input: {
    pageId: string;
    ref?: string | undefined;
    observationVersion?: number | undefined;
    /** A Playwright chord the schema checked against the closed key vocabulary. */
    keys: string;
    allowedOrigins?: Origins;
  },
): Promise<Record<string, unknown>> {
  const chord = input.keys;
  return pages.withPage(op, input.pageId, async (page) => {
    const element = await readOptional(pages, op, input, input.allowedOrigins, page);
    if (element?.disabled === true)
      throw new WorkerError('unsupported', 'The element is disabled.');
    throwIfCancelled(op);
    op.dispatched = true;
    if (element === undefined) await pw(op, page.keyboard.press(chord));
    else await pw(op, locatorFor(element).press(chord, actionOptions(op)));
    await settleRead(pages, op, input.pageId, page, input.allowedOrigins);
    return {};
  });
}

/** `select`: chooses the option with this visible label in a native select element. */
export async function select(
  pages: Pages,
  op: Operation,
  input: {
    pageId: string;
    ref: string;
    observationVersion: number;
    label: string;
    allowedOrigins?: Origins;
  },
): Promise<Record<string, unknown>> {
  return pages.withPage(op, input.pageId, async (page) => {
    const { element } = await readCurrent(pages, op, input, page);
    if (!SELECT_ROLES.has(element.role)) throw new WorkerError('unsupported', 'Not a select.');
    if (element.disabled) throw new WorkerError('unsupported', 'The element is disabled.');
    const locator = locatorFor(element);
    const has = await pw(
      op,
      locator.evaluate(
        (node: ChoiceNode, label: string) =>
          node.tagName === 'SELECT' && node.options !== undefined
            ? Array.from(node.options).some((option) => option.label === label)
            : null,
        input.label,
        { timeout: READ_TIMEOUT_MS },
      ),
    );
    if (has === null) throw new WorkerError('unsupported', 'Only select elements are supported.');
    if (!has) throw new WorkerError('notFound', 'The select has no option with that label.');
    throwIfCancelled(op);
    op.dispatched = true;
    const values = await pw(op, locator.selectOption({ label: input.label }, actionOptions(op)));
    await settleRead(pages, op, input.pageId, page, input.allowedOrigins);
    return {
      verified: values.length === 1,
      evidence: [{ kind: 'value', summary: `${element.name || 'select'}: ${input.label}` }],
    };
  });
}

/** The real paths of `paths`, each a regular file of at most 50 MB inside the upload root. */
async function uploadFiles(paths: readonly string[]): Promise<string[]> {
  const root = process.env['ATD_UPLOAD_ROOT'];
  if (root === undefined || !path.isAbsolute(root))
    throw new WorkerError('unsupported', 'This worker has no upload root.');
  const realRoot = await realpath(root).catch(() => {
    throw new WorkerError('unsupported', 'The upload root does not exist.');
  });
  const files: string[] = [];
  for (const file of paths) {
    const real = await realpath(file).catch(() => undefined);
    if (real === undefined || !real.startsWith(`${realRoot}${path.sep}`))
      throw new WorkerError('unsupported', 'A file is outside the upload root.');
    const info = await stat(real);
    if (!info.isFile() || info.size > MAX_UPLOAD_BYTES)
      throw new WorkerError('unsupported', 'A file is not a regular file of at most 50 MB.');
    files.push(real);
  }
  return files;
}

/** `upload`: sets task files on a file input. */
export async function upload(
  pages: Pages,
  op: Operation,
  input: {
    pageId: string;
    ref: string;
    observationVersion: number;
    paths: string[];
    allowedOrigins?: Origins;
  },
): Promise<Record<string, unknown>> {
  const files = await uploadFiles(input.paths);
  return pages.withPage(op, input.pageId, async (page) => {
    const { element } = await readCurrent(pages, op, input, page);
    if (element.disabled) throw new WorkerError('unsupported', 'The element is disabled.');
    const locator = locatorFor(element);
    const isFile = await pw(
      op,
      locator.evaluate(
        (node: ChoiceNode) => node.tagName === 'INPUT' && node.type === 'file',
        undefined,
        { timeout: READ_TIMEOUT_MS },
      ),
    );
    if (!isFile) throw new WorkerError('unsupported', 'Not a file input.');
    throwIfCancelled(op);
    op.dispatched = true;
    await pw(op, locator.setInputFiles(files, actionOptions(op)));
    await settleRead(pages, op, input.pageId, page, input.allowedOrigins);
    const target = element.name || 'the file input';
    return {
      evidence: [{ kind: 'text', summary: `${String(files.length)} file(s) set on ${target}` }],
    };
  });
}
