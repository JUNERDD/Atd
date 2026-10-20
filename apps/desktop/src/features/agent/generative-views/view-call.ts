import type { useTranslation } from 'react-i18next';
import { Value } from 'typebox/value';
import {
  ShowUiParamsSchema,
  VIEW_DISMISSED_TEXT,
  VIEW_RESPONSE_PREFIX,
} from '@atd/agent-contracts';
import type { InputRequest } from '../../../client/agent/permission-schema';
import type { BlockOf } from '../../../client/agent/transcript-schema';

/**
 * What a view's widget card and window read from its `show_ui` call. A view is the call: its id
 * names the view in `update_ui`, in the renderer's stores, in the shell's document URLs and in
 * `view.open`, and its arguments carry the title, whether it has a widget, the window's preferred
 * size, the initial data and whether the agent waits for the user's response.
 */

/** A view's key in the renderer's stores: its task and its `show_ui` call. */
export function viewKey(taskId: string, callId: string): string {
  return `${taskId}/${callId}`;
}

/**
 * Where a view stands, from its call and whether an input request is or was pending on it
 * (`waited`, for a call made with `wait`):
 * - `preparing`: the call is still being written, or runs before its view shows;
 * - `ready`: the view can show: the call completed or was interrupted (the service still serves
 *   its document), or it waits for the user's response. It stays ready from the answer until the
 *   call's result arrives, while the call runs on without a request, so the view the user just
 *   used does not reload;
 * - `failed`: the service refused the call, and its result says why;
 * - `declined`: the call never ran, so there is no view to show.
 */
export type ViewPhase = 'preparing' | 'ready' | 'failed' | 'declined';

export function viewPhase(block: BlockOf<'tool'>, waited: boolean): ViewPhase {
  switch (block.status) {
    case 'running':
      return waited ? 'ready' : 'preparing';
    case 'completed':
    case 'interrupted':
      return 'ready';
    case 'failed':
      return 'failed';
    case 'declined':
      return 'declined';
  }
}

/** The view's title, once the streamed arguments hold some of it. */
export function viewTitle(block: BlockOf<'tool'>): string | null {
  const title = block.args.title;
  return typeof title === 'string' && title.trim() ? title : null;
}

/** Whether the call gives the view a widget; without one its card shows only the title. */
export function viewHasWidget(block: BlockOf<'tool'>): boolean {
  const widget = block.args.widget;
  return typeof widget === 'string' && widget.length > 0;
}

const WindowSizeSchema = ShowUiParamsSchema.properties.window;

/**
 * The window's preferred size in points (`show_ui` `window`, title bar included): null for a side
 * the call does not name, and for both when it names a size the contract does not allow, so the
 * shell opens the window at its default size there.
 */
export function viewWindowSize(block: BlockOf<'tool'>): {
  width: number | null;
  height: number | null;
} {
  const size = block.args.window;
  if (size === undefined || !Value.Check(WindowSizeSchema, size))
    return { width: null, height: null };
  return { width: size.width ?? null, height: size.height ?? null };
}

export type ViewResponse = { kind: 'responded'; text: string } | { kind: 'dismissed' };

/**
 * How the user settled a waiting view, read back from the result `show_ui` gave the agent; null
 * for a view that did not wait or is not settled.
 */
export function viewResponse(block: BlockOf<'tool'>): ViewResponse | null {
  if (block.status !== 'completed' || block.args.wait !== true) return null;
  if (block.output.startsWith(VIEW_RESPONSE_PREFIX))
    return { kind: 'responded', text: block.output.slice(VIEW_RESPONSE_PREFIX.length) };
  return block.output === VIEW_DISMISSED_TEXT ? { kind: 'dismissed' } : null;
}

type T = ReturnType<typeof useTranslation<'tasks'>>['t'];

/**
 * What a view's card and window say at their trailing edge: why they show no view, or how far the
 * user's part has come. `available` says whether the surface can show the ready view at all.
 */
export function viewStatus(
  t: T,
  block: BlockOf<'tool'>,
  phase: ViewPhase,
  available: boolean,
  request: InputRequest | undefined,
): string | undefined {
  if (phase === 'failed') return t('activity.failed');
  if (phase === 'declined' || (phase === 'ready' && !available)) return t('view.unavailable');
  if (request) return t('permission.waitingAnswer');
  const response = viewResponse(block);
  if (response) return response.kind === 'responded' ? t('view.responded') : t('question.skipped');
  return block.status === 'interrupted' ? t('activity.interrupted') : undefined;
}
