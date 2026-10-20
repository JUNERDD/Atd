import { ArrowUpRight, PanelsTopLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Shimmer } from '@atd/ui/components/ai-elements/shimmer';
import type { InputRequest } from '../../../client/agent/permission-schema';
import type { ViewWindowRequest } from '../../../client/contract';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { ToolCard } from '../transcript/tool-card';
import {
  viewHasWidget,
  viewPhase,
  viewResponse,
  viewStatus,
  viewTitle,
  viewWindowSize,
} from './view-call';
import { useTaskViews } from './view-fold';
import { ViewFrame } from './view-frame';
import { openViewWindow, useViewOpener } from './view-open';
import { useViewMount, useWaited } from './use-view-mount';
import './view-card.css';

/**
 * A view the agent showed with `show_ui`, inline in its turn as the view's widget. The card stands
 * like the computer-use monitor window: glass behind it and the panel's translucent fill inside
 * the glass's rim (`view-card.css`); on top, the tool card's rows (the view's mark and title, its
 * state and the open-window glyph at the trailing edge) and, when the call has a widget, the
 * widget's frame (`ViewFrame`) edge to edge; without one the card is that row alone. The widget is
 * a glance: once the view can show, the whole card is one button that opens the view's window,
 * where the user works with it, so the frame under the button takes no input. While the call is
 * written the card holds a loading line; a call the service refused shows why. A waiting view
 * (`wait`) says so until the user responds, in its window or from the composer, and then shows
 * the response under the widget. A widget that never loads offers a retry above the button; a
 * retry and a rewind that took back data the widget already applied both load it anew. Outside a
 * task's own transcript (`useTaskViews`) there is no view to show or open.
 */
export function ViewCard({
  block,
  request,
}: {
  block: BlockOf<'tool'>;
  /** The pending input request on this call while the agent waits for the user's response. */
  request: InputRequest | undefined;
}) {
  const { t } = useTranslation('tasks');
  const host = useTaskViews();
  const snapshot = host?.views.get(block.callId);
  const waited = useWaited(request);
  const phase = viewPhase(block, waited);
  const title = viewTitle(block) ?? t('view.untitled');
  const response = viewResponse(block);
  const { mount, lost, onLost, retry } = useViewMount(snapshot?.revision ?? 0);
  // The window opens once the view can show: its call ready in its task's own transcript.
  const opener: ViewWindowRequest | null =
    phase === 'ready' && host && snapshot
      ? { taskId: host.taskId, callId: block.callId, title, ...viewWindowSize(block) }
      : null;
  useViewOpener(opener);
  const widget = opener && snapshot && viewHasWidget(block) ? snapshot : null;
  const status = viewStatus(t, block, phase, opener !== null, request);
  const meta =
    status || opener ? (
      <>
        {status}
        {opener && <ArrowUpRight aria-hidden className="size-3" />}
      </>
    ) : undefined;
  return (
    <div className="view-card glass-host">
      {/* The glass is a childless layer behind the card: the rows and the frame change while
          shown, and system glass hosts every layer of the element it is on (`surface-glass`). */}
      <span aria-hidden className="view-card-glass surface-glass" />
      <span aria-hidden className="view-card-fill" />
      {opener && (
        <button
          type="button"
          className="view-card-open glass-state"
          aria-label={t('view.openWindow', { title })}
          onClick={() => void openViewWindow(opener)}
        />
      )}
      <div className="view-card-content">
        <ToolCard.Header
          icon={<PanelsTopLeft />}
          label={<span title={title}>{title}</span>}
          meta={meta}
        />
        {phase === 'preparing' && (
          <div className="view-note">
            <Shimmer as="span">{t('view.preparing')}</Shimmer>
          </div>
        )}
        {phase === 'failed' && (
          <ToolCard.Body size="sm">
            <p className="m-0 wrap-anywhere whitespace-pre-wrap text-muted-foreground">
              {block.output}
            </p>
          </ToolCard.Body>
        )}
        {(phase === 'declined' || (phase === 'ready' && !opener)) && (
          <div className="view-note">{t('view.unavailableNote')}</div>
        )}
        {widget && host && !lost && (
          <ViewFrame
            key={mount}
            surface="widget"
            taskId={host.taskId}
            callId={block.callId}
            title={title}
            snapshot={widget}
            onLost={onLost}
          />
        )}
        {widget && lost && (
          <div className="view-note">
            <span>{t('view.widgetLost')}</span>
            {/* Flush on the glass, above the card's button: the washes and the focus ring stay
                inside the button. */}
            <Button variant="glass-ghost" size="xs" className="view-card-retry" onClick={retry}>
              {t('view.retry')}
            </Button>
          </div>
        )}
        {response?.kind === 'responded' && (
          <ToolCard.Footer>
            <p
              className="m-0 line-clamp-3 min-w-0 wrap-anywhere whitespace-pre-wrap"
              title={response.text}
            >
              {t('view.response', { response: response.text })}
            </p>
          </ToolCard.Footer>
        )}
      </div>
    </div>
  );
}
