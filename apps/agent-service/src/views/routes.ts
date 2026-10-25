import type { FastifyInstance } from 'fastify';
import { Compile } from 'typebox/compile';
import {
  ShowUiParamsSchema,
  VIEW_DOCUMENT_ROUTE,
  VIEW_WIDGET_ROUTE,
  type ViewSurface,
} from '@atd/agent-contracts';
import { LedgerNotFound, type Ledger } from '../ledger.js';
import { SHELL_ROUTE } from '../relay-routes.js';
import { readSessionBranch } from '../session-branch-read.js';
import { findShowUiCall } from './calls.js';
import { viewProblems } from './content.js';
import { viewDocument } from './document.js';
import { loadViewKit } from './kit.js';

const ShowUiParams = Compile(ShowUiParamsSchema);

/**
 * Assembled documents kept per service, most recently served last. A call's document never
 * changes once its assistant message is on the branch, and a view loads its document again each
 * time its widget or window mounts.
 */
const CACHED_DOCUMENTS = 16;

export interface ViewRouteDeps {
  ledger: Ledger;
}

/** The route of each surface's document. */
const SURFACE_ROUTES: readonly (readonly [route: string, surface: ViewSurface])[] = [
  [VIEW_DOCUMENT_ROUTE, 'window'],
  [VIEW_WIDGET_ROUTE, 'widget'],
];

/**
 * The shell-only routes that serve a view's documents (`VIEW_DOCUMENT_ROUTE` for the window,
 * `VIEW_WIDGET_ROUTE` for the widget): the shell fetches them with the service token for the view
 * origin and adds the view CSP; the relay never forwards them. Only a `show_ui` call whose
 * arguments pass the schema and `viewProblems` is served, so a call the tool rejected never is;
 * one that waits or was interrupted is served like any other. A call without a `widget` has no
 * widget document: the host draws a plain card instead.
 */
export function registerViewRoutes(app: FastifyInstance, deps: ViewRouteDeps): void {
  const cache = new Map<string, string>();
  for (const [route, surface] of SURFACE_ROUTES)
    app.get<{ Params: { taskId: string; callId: string } }>(
      route,
      SHELL_ROUTE,
      async (request, reply) => {
        const { taskId, callId } = request.params;
        const { sessionFile } = deps.ledger.task(taskId);
        const key = JSON.stringify([taskId, callId, surface]);
        const document = cache.get(key) ?? (await assembleView(sessionFile, callId, surface));
        cache.delete(key);
        cache.set(key, document);
        for (const stale of cache.keys()) {
          if (cache.size <= CACHED_DOCUMENTS) break;
          cache.delete(stale);
        }
        return reply
          .header('content-type', 'text/html; charset=utf-8')
          .header('cache-control', 'no-store')
          .send(document);
      },
    );
}

/**
 * The document of one surface of the task's `show_ui` call `callId`. The branch is read from the
 * task's session file, live session or not: Pi appends each entry to the file as it adds it to
 * the branch (`SessionManager._persist`), and a view's call is on the branch, and so in the file,
 * before its tool runs. A message still streaming is in neither, so a call is never served half
 * written.
 */
async function assembleView(
  sessionFile: string | null,
  callId: string,
  surface: ViewSurface,
): Promise<string> {
  const branch = sessionFile ? await readSessionBranch(sessionFile) : null;
  const call = branch && findShowUiCall(branch, callId);
  if (!call || !ShowUiParams.Check(call.args)) throw new LedgerNotFound('View', callId);
  if (surface === 'widget' && call.args.widget === undefined)
    throw new LedgerNotFound('View widget', callId);
  const kit = await loadViewKit();
  if (viewProblems(call.args, kit.blocks).length) throw new LedgerNotFound('View', callId);
  return viewDocument(call.args, kit, surface);
}
