import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Shimmer } from '@atd/ui/components/ai-elements/shimmer';
import { SHOW_UI_TOOL, VIEW_WINDOW_TITLE_BAR_HEIGHT } from '@atd/agent-contracts';
import type { InputRequest } from '../../../client/agent/permission-schema';
import type { Block, BlockOf } from '../../../client/agent/transcript-schema';
import { ToastHost } from '../../../components/toast';
import { useAppLanguage } from '../../../i18n/use-app-language';
import { useGlowEffects } from '../../../theme/glow-effects';
import { useSettingsSnapshot } from '../../settings/use-settings';
import { useAgent, useTaskDetail } from '../use-agent';
import { viewPhase, viewStatus, viewTitle } from './view-call';
import { useViewSnapshots } from './view-fold';
import { ViewFrame } from './view-frame';
import { useViewMount, useWaited } from './use-view-mount';
import './view-window.css';

/** The view a window shows, from the URL the shell loads it at (`#view?task=…&call=…`). */
function windowTarget(): { taskId: string; callId: string } | null {
  const { hash } = window.location;
  if (!hash.startsWith('#view?')) return null;
  const query = new URLSearchParams(hash.slice('#view?'.length));
  const taskId = query.get('task');
  const callId = query.get('call');
  return taskId && callId ? { taskId, callId } : null;
}

const NO_BLOCKS: readonly Block[] = [];

/**
 * Whether the task went away while the window showed it: the service listed it, then no longer.
 * A task never listed yet may still be loading, so only a listed one can go.
 */
function useTaskGone(taskId: string | null): boolean {
  const { snapshot } = useAgent();
  const listed = snapshot?.tasks.some((task) => task.id === taskId) ?? false;
  const [seen, setSeen] = useState(false);
  if (listed && !seen) setSeen(true);
  return seen && !listed;
}

/**
 * A view's window (`#view`), which the shell opens from the view's widget card or the composer's
 * waiting-view request (`view.open`): the whole interactive view, where the user works with it and
 * where its messages to the agent come from. The shell draws the window's glass and the panel's
 * translucent fill natively, so the page paints no surface. A 52px header on the unified title bar
 * clears the traffic lights and names the view, with its state at the trailing edge, and drags the
 * window; the view's window document fills the rest (`ViewFrame`), with the same data as its widget:
 * the task's transcript, loaded and followed here, is the only store. A loading line stands in
 * until the view shows, and a note says when it cannot: the task went away, its transcript has no
 * such call, the call failed or never ran, or the document never loaded, which offers a retry.
 */
export function ViewWindow() {
  const { t } = useTranslation('tasks');
  const [target] = useState(windowTarget);
  const { snapshot: settings } = useSettingsSnapshot();
  useAppLanguage(settings?.language);
  useGlowEffects(settings?.glowEffects);
  const callId = target?.callId ?? null;
  const { detail } = useTaskDetail(target?.taskId ?? null);
  const gone = useTaskGone(target?.taskId ?? null);
  const views = useViewSnapshots(detail?.blocks ?? NO_BLOCKS);
  const block = detail?.blocks.find(
    (item): item is BlockOf<'tool'> =>
      item.kind === 'tool' && item.name === SHOW_UI_TOOL && item.callId === callId,
  );
  const request = detail?.requests.find(
    (item): item is InputRequest => item.kind === 'input' && item.toolCallId === callId,
  );
  const waited = useWaited(request);
  const snapshot = callId === null ? undefined : views.get(callId);
  const { mount, lost, onLost, retry } = useViewMount(snapshot?.revision ?? 0);
  const phase = block ? viewPhase(block, waited) : null;
  // No view at all: no target, the task went away, or its loaded transcript has no such call.
  const missing = target === null || gone || (detail !== null && block === undefined);
  const loading = !missing && (detail === null || phase === 'preparing');
  const frame =
    !missing && phase === 'ready' && target && snapshot && !lost ? { target, snapshot } : null;
  // Named once the transcript loaded, or once the window knows it has no view.
  const title =
    !missing && detail === null ? '' : ((block && viewTitle(block)) ?? t('view.untitled'));
  const status = missing
    ? t('view.unavailable')
    : block && phase
      ? viewStatus(t, block, phase, !lost, request)
      : undefined;

  let body: ReactNode;
  if (frame)
    body = (
      <ViewFrame
        key={mount}
        surface="window"
        taskId={frame.target.taskId}
        callId={frame.target.callId}
        title={title}
        snapshot={frame.snapshot}
        request={request}
        onLost={onLost}
      />
    );
  else if (loading)
    body = (
      <div className="view-note" data-surface="window">
        <Shimmer as="span">{t(detail === null ? 'view.loading' : 'view.preparing')}</Shimmer>
      </div>
    );
  else
    body = (
      <div className="view-note" data-surface="window">
        <span>{t('view.unavailableNote')}</span>
        {lost && !missing && (
          <Button variant="outline" size="sm" onClick={retry}>
            {t('view.retry')}
          </Button>
        )}
      </div>
    );

  return (
    <div className="view-window">
      <header className="view-window-header">
        <h1 className="min-w-0 flex-auto truncate text-sm font-medium" title={title}>
          {title}
        </h1>
        {status && (
          <span className="min-w-0 truncate text-xs text-muted-foreground" title={status}>
            {status}
          </span>
        )}
      </header>
      <main className="view-window-body">{body}</main>
      <ToastHost top={VIEW_WINDOW_TITLE_BAR_HEIGHT} />
    </div>
  );
}
