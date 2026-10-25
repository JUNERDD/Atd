import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import { fill, navigate, press, scroll } from './actions.js';
import { wait } from './conditions.js';
import { Downloads, downloadRootFor } from './downloads.js';
import { key, select, upload } from './inputs.js';
import { observe } from './observe.js';
import { pageFocus } from './occupancy.js';
import { openPage } from './open.js';
import * as openingSchemas from './opening-schemas.js';
import { OperationRegistry, WorkerError, type Operation } from './operations.js';
import { browserSocketFromEnvironment } from './connection.js';
import { Pages } from './pages.js';
import { Previews } from './preview.js';
import * as previewSchemas from './preview-schemas.js';
import { profileDownloadDir } from './profile-downloads.js';
import * as schemas from './schemas.js';
import { truncate } from './text.js';
import { restoreWindows } from './windows.js';

/**
 * The browser worker's entry (`dist/computer/worker/server.js`): a private MCP server on
 * stdin/stdout that the Swift shell starts with the bundled Node, one process per managed browser
 * profile, attached with playwright-core over CDP. The host builds the environment from scratch:
 * the verified browser socket in `ATD_CDP_WS` and the upload root in `ATD_UPLOAD_ROOT`
 * (`<dataDir>/resources`), whose data directory also holds the download root
 * (`<dataDir>/computer/downloads`, downloads.ts). It is never registered as a user MCP server and
 * never started by the service. It opens no listener and writes files only into run directories
 * of the download root, except that a download on a page no call named (the person's own) goes
 * to the managed profile's own download folder, where Chrome would have put it, and it starts
 * no process but `/usr/bin/osascript`, which marks each saved download as Chrome would
 * (quarantine.ts); a page-changing call's reply lists the downloads saved into its `downloadDir`
 * that no reply reported before.
 *
 * The tool set is closed: `list_pages`, `observe`, `fill` (an empty text clears), `press`,
 * `scroll`, `wait`, `navigate`, `key`, `select`, `upload`, `downloads` and `cancel` act on exact
 * page targets (`schemas.ts` documents the shapes), `page_focus` reads whether the person is
 * looking at a page, `open_page` opens an approved website's page in a background tab (or a parked
 * background window) and `restore_windows` puts parked windows back on a display for a person who
 * opens the browser (`opening-schemas.ts`), and `capabilities` reports the worker and the pinned
 * playwright-core for the pack check (`verify-app`). There is no evaluate, raw CDP, coordinate or
 * drag tool, and no tool focuses a page, raises a window or activates the browser: the worker
 * keeps Playwright's default focus emulation and never calls `bringToFront`, so the person's
 * screen stays theirs.
 * Calls run concurrently; the host's resource arbiter serializes work on one page.
 */

const WORKER_VERSION = '0.6.0';
const PLAYWRIGHT_CORE_VERSION = (
  createRequire(import.meta.url)('playwright-core/package.json') as { version: string }
).version;

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

/** The text content mirrors the structured result without screenshot data. */
function toolResult(structured: Record<string, unknown>, isError: boolean): ToolResult {
  const { screenshot, frame, ...rest } = structured;
  if (frame !== undefined) rest.frame = '[preview jpeg]';
  const text = JSON.stringify(screenshot === undefined ? rest : { ...rest, screenshot: '[png]' });
  return isError
    ? { content: [{ type: 'text', text }], structuredContent: structured, isError: true }
    : { content: [{ type: 'text', text }], structuredContent: structured };
}

/**
 * Runs one page tool as an operation and shapes its result: `dispatched` comes from the
 * operation, so a failure after a dispatch still says the page may have changed. Errors that are
 * not a `WorkerError` (CDP failures, a closed socket) become `engineFailed`.
 */
async function runOperation(
  registry: OperationRegistry,
  signal: AbortSignal,
  input: { pageId?: string; operationId?: string | undefined },
  work: (op: Operation) => Promise<Record<string, unknown>>,
  report: () => Promise<Record<string, unknown>> = async () => ({}),
): Promise<ToolResult> {
  const op = registry.begin(signal, input.operationId);
  const page = () => ({
    dispatched: op.dispatched,
    pageId: input.pageId,
    navigationGeneration: op.navigationGeneration,
    observationVersion: op.observationVersion,
  });
  try {
    const fields = await work(op);
    return toolResult({ ok: true, ...page(), ...fields, ...(await report()) }, false);
  } catch (error) {
    const code = error instanceof WorkerError ? error.code : 'engineFailed';
    const message = truncate(error instanceof Error ? error.message : String(error), 2000);
    const saved = await report();
    return toolResult({ ok: false, ...page(), error: { code, message }, ...saved }, true);
  } finally {
    registry.end(op);
  }
}

async function main(): Promise<void> {
  const uploadRoot = process.env['ATD_UPLOAD_ROOT'];
  const socket = browserSocketFromEnvironment();
  const downloads = new Downloads(downloadRootFor(uploadRoot), () =>
    profileDownloadDir(uploadRoot, socket),
  );
  const pages = new Pages(socket, downloads);
  const previews = new Previews(pages);
  const registry = new OperationRegistry();
  const server = new McpServer({ name: 'atd-computer-browser-worker', version: WORKER_VERSION });
  const tools: string[] = [];
  const register = <Input extends z.ZodObject>(
    name: string,
    description: string,
    input: Input,
    output: z.ZodRawShape,
    work: (op: Operation, args: z.infer<Input>) => Promise<Record<string, unknown>>,
  ): void => {
    tools.push(name);
    // Widened to the non-generic schema type: the SDK's callback type is a conditional over the
    // schema that stays deferred for a generic one. The SDK validated `args` against `input`
    // before calling, so it is `z.infer<Input>`.
    const inputSchema: z.ZodObject = input;
    server.registerTool(name, { description, inputSchema, outputSchema: output }, (args, extra) => {
      const parsed = args as z.infer<Input>;
      const ids = parsed as { pageId?: string; operationId?: string; downloadDir?: string };
      let dir: string | undefined;
      // Before the work: a download the call causes goes to the run directory it names; after
      // it, success or not, the reply lists what was saved there and not reported before.
      const prepare = async (): Promise<void> => {
        if (ids.pageId === undefined || ids.downloadDir === undefined) return;
        dir = await downloads.runDir(ids.downloadDir);
        downloads.assign(ids.pageId, dir);
      };
      const report = async (): Promise<Record<string, unknown>> => {
        const saved = dir === undefined ? [] : await downloads.take(dir);
        return saved.length > 0 ? { downloads: saved } : {};
      };
      return runOperation(
        registry,
        extra.signal,
        ids,
        async (op) => {
          await prepare();
          return work(op, parsed);
        },
        report,
      );
    });
  };

  register(
    'list_pages',
    'Lists the page targets of this browser profile (pageId = CDP target id, url, title).',
    z.strictObject(schemas.listPagesInput),
    schemas.listPagesOutput,
    async () => ({ pages: await pages.list() }),
  );
  register(
    'observe',
    'Reads one page: URL, title, up to 300 actionable elements (values truncated, secrets masked), observationVersion, a newText baselineId and, on request, a PNG of the viewport.',
    z.strictObject(schemas.observeInput),
    schemas.observeOutput,
    (op, args) => observe(pages, op, args),
  );
  register(
    'fill',
    "Replaces a text field's value (input, textarea or content-editable) with text, or empties it when text is empty, verifying the value and focus. Refuses a stale observationVersion.",
    z.strictObject(schemas.fillInput),
    schemas.fillOutput,
    (op, args) => fill(pages, op, args),
  );
  register(
    'press',
    'Clicks an enabled element with trusted input after an actionability trial that sends nothing. Refuses disabled elements and stale observations. Returns a newText baselineId taken just before the click.',
    z.strictObject(schemas.pressInput),
    schemas.pressOutput,
    (op, args) => press(pages, op, args),
  );
  register(
    'scroll',
    'Scrolls the window, or an element of the observation, up, down, left or right by amount × 100 px.',
    z.strictObject(schemas.scrollInput),
    schemas.scrollOutput,
    (op, args) => scroll(pages, op, args),
  );
  register(
    'wait',
    'Polls one fixed condition (enabled, valueEquals, textAppears, urlMatches, newText) until it holds, timeoutMs passes, or the operation is cancelled. Never changes the page.',
    z.strictObject(schemas.waitInput),
    schemas.waitOutput,
    (op, args) => wait(pages, op, args),
  );
  register(
    'navigate',
    'Opens an http(s) URL in the page (the host has checked its origin) and waits for load, at most 10 s.',
    z.strictObject(schemas.navigateInput),
    schemas.navigateOutput,
    (op, args) => navigate(pages, op, args),
  );
  register(
    'key',
    'Presses a key chord of the closed key vocabulary (Playwright names), on the focused element or on ref.',
    z.strictObject(schemas.keyInput),
    schemas.keyOutput,
    (op, args) => key(pages, op, args),
  );
  register(
    'select',
    'Chooses the option with this visible label in a select element.',
    z.strictObject(schemas.selectInput),
    schemas.selectOutput,
    (op, args) => select(pages, op, args),
  );
  register(
    'upload',
    'Sets files inside the upload root on a file input.',
    z.strictObject(schemas.uploadInput),
    schemas.uploadOutput,
    (op, args) => upload(pages, op, args),
  );
  register(
    'downloads',
    'Lists the downloads saved into (or failed for) one run directory of the download root.',
    z.strictObject(schemas.downloadsInput),
    schemas.downloadsOutput,
    async (_op, args) => ({ downloads: downloads.list(await downloads.runDir(args.downloadDir)) }),
  );
  register(
    'preview_start',
    'Starts a read-only preview of the exact observed page.',
    z.strictObject(previewSchemas.previewStartInput),
    previewSchemas.previewOutput,
    (op, args) => previews.start(op, args),
  );
  register(
    'preview_read',
    'Reads the newest preview frame without changing observations.',
    z.strictObject(previewSchemas.previewLeaseInput),
    previewSchemas.previewOutput,
    async (_op, args) => previews.read(args.previewId),
  );
  register(
    'preview_stop',
    'Ends this viewer preview and releases its frame.',
    z.strictObject(previewSchemas.previewLeaseInput),
    previewSchemas.previewOutput,
    async (_op, args) => {
      await previews.stop(args.previewId);
      return {};
    },
  );
  register(
    'page_focus',
    'Reports, for the named pages, whether each is the tab a window shows (visibilityState) and whether it answers document.hasFocus(). Reads only; focuses, raises and activates nothing.',
    z.strictObject(openingSchemas.pageFocusInput),
    openingSchemas.pageFocusOutput,
    (op, args) => pageFocus(pages, op, args),
  );
  register(
    'open_page',
    'Opens an http(s) page of an approved website in a new background tab (not selected, window not brought forward) and waits for its document to commit, at most 13 s. Needs a browser that has a window, unless parkAt is given: then the page opens in a new background window moved to that frame.',
    z.strictObject(openingSchemas.openPageInput),
    openingSchemas.openPageOutput,
    (op, args) => openPage(pages, op, args),
  );
  register(
    'restore_windows',
    'Moves windows of this browser that lie mostly outside the given displays to the given frame. Moves windows only; focuses, raises and activates nothing.',
    z.strictObject(openingSchemas.restoreWindowsInput),
    openingSchemas.restoreWindowsOutput,
    (op, args) => restoreWindows(pages, op, args),
  );
  // Not an operation itself: it must not carry, or be aborted by, the id it cancels.
  server.registerTool(
    'cancel',
    {
      description:
        'Aborts the in-flight calls carrying operationId, and refuses later calls that carry it.',
      inputSchema: z.strictObject(schemas.cancelInput),
      outputSchema: schemas.cancelOutput,
    },
    ({ operationId }) =>
      toolResult({ ok: true, dispatched: false, aborted: registry.cancel(operationId) }, false),
  );
  tools.push('cancel');
  server.registerTool(
    'capabilities',
    {
      description: 'Reports the worker and playwright-core versions and the tool list.',
      inputSchema: z.strictObject({}),
      outputSchema: schemas.capabilitiesOutput,
    },
    () => {
      const report = {
        worker: WORKER_VERSION,
        playwrightCore: PLAYWRIGHT_CORE_VERSION,
        tools: [...tools],
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(report) }],
        structuredContent: report,
      };
    },
  );

  let stopping = false;
  // The host owns the worker's lifetime: closing stdin (also when the host dies) or SIGTERM ends
  // it after in-flight calls are aborted and every page connection is closed.
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    registry.cancelAll();
    // closeAll never rejects; the exit follows however the server closes.
    void previews
      .closeAll()
      .then(() => pages.closeAll())
      .then(() => server.close())
      .finally(() => process.exit(0));
  };
  process.stdin.once('end', stop);
  process.stdin.once('close', stop);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  await server.connect(new StdioServerTransport());
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `computer worker: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
