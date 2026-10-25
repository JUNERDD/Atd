import { useEffect } from 'react';
import type { InputRequest } from '../../../client/agent/permission-schema';
import type { ViewWindowRequest } from '../../../client/contract';
import { showErrorToast } from '../../../components/toast-store';
import i18n from '../../../i18n';
import { viewKey } from './view-call';

/**
 * Opening a view's window, where the user works with the view: its card opens it with the call's
 * title and preferred size, and the composer's HITL popover opens the window of the view a
 * request waits on, which it does not render, through what a card of that view registered.
 */

/** What the mounted cards open, by view key. */
const openers = new Map<string, Set<ViewWindowRequest>>();

/** Opens the view's window or brings it forward; a failure shows as an error toast. */
export async function openViewWindow(request: ViewWindowRequest): Promise<void> {
  try {
    const views = window.desktop?.views;
    if (!views) throw new Error(i18n.t('panel:errors.openDesktopApp'));
    await views.open(request);
  } catch (error) {
    showErrorToast(error);
  }
}

/**
 * Opens the window of the view `request` waits on as its card would, or, with no card of it
 * mounted (its turn not rendered), with the request's title at the shell's default size.
 */
export function openWaitingView(request: InputRequest): Promise<void> {
  const [card] = openers.get(viewKey(request.taskId, request.toolCallId)) ?? [];
  return openViewWindow(
    card ?? {
      taskId: request.taskId,
      callId: request.toolCallId,
      title: request.title,
      width: null,
      height: null,
    },
  );
}

/** Registers what a card opens while it is mounted and its view can show (`request` set). */
export function useViewOpener(request: ViewWindowRequest | null): void {
  const taskId = request?.taskId ?? null;
  const callId = request?.callId ?? null;
  const title = request?.title ?? null;
  const width = request?.width ?? null;
  const height = request?.height ?? null;
  useEffect(() => {
    if (taskId === null || callId === null || title === null) return;
    const key = viewKey(taskId, callId);
    const opener: ViewWindowRequest = { taskId, callId, title, width, height };
    const cards = openers.get(key) ?? new Set<ViewWindowRequest>();
    cards.add(opener);
    openers.set(key, cards);
    return () => {
      cards.delete(opener);
      if (cards.size === 0 && openers.get(key) === cards) openers.delete(key);
    };
  }, [taskId, callId, title, width, height]);
}
