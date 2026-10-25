import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shimmer } from '@atd/ui/components/ai-elements/shimmer';
import { viewDocumentUrl, type ViewSurface } from '@atd/agent-contracts';
import type { InputRequest } from '../../../client/agent/permission-schema';
import { useColorScheme } from '../../../theme/color-scheme';
import { ToolCard } from '../transcript/tool-card';
import type { ViewSnapshot } from './view-fold';
import { useViewHost } from './use-view-host';
import './view-frame.css';

/**
 * One load of one of a view's documents: a sandboxed frame at the view origin, which the shell
 * serves only inside renderer pages, with scripts and forms but never this page's origin. It loads
 * unseen behind a loading line until the view answered the handshake and reported its size
 * (`useViewHost`), then shows: a widget at the height it reports across the card's width, taking
 * neither the pointer nor the keyboard, which the card's button above it takes; a window filling
 * the page below its title bar, with focus moved into it so the keyboard reaches the view. Script
 * errors the view reports read as a warning under it, with the first message that says more than
 * WebKit's muted one. A retry mounts a new one; the frame's URL never changes while it is mounted.
 */
export function ViewFrame({
  surface,
  taskId,
  callId,
  title,
  snapshot,
  request,
  onLost,
}: {
  surface: ViewSurface;
  taskId: string;
  callId: string;
  /** The frame's accessible name. */
  title: string;
  snapshot: ViewSnapshot;
  /** The pending input request on the view's call, which the window's messages answer. */
  request?: InputRequest | undefined;
  onLost: () => void;
}) {
  const { t, i18n } = useTranslation('tasks');
  const theme = useColorScheme();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const frameRef = useRef<HTMLIFrameElement>(null);
  // The query seeds the document's first paint only; later theme and language changes reach the
  // view through the protocol, so the frame never reloads for them.
  const [src] = useState(() => viewDocumentUrl(taskId, callId, { theme, lang: locale, surface }));
  const { ready, scriptError } = useViewHost(frameRef, {
    surface,
    taskId,
    callId,
    theme,
    locale,
    snapshot,
    request,
    onLost,
  });
  useEffect(() => {
    if (ready && surface === 'window') frameRef.current?.focus();
  }, [ready, surface]);
  return (
    <>
      <div className="view-stage" data-surface={surface} data-ready={ready || undefined}>
        {!ready && (
          <div className="view-note" data-surface={surface}>
            <Shimmer as="span">{t('view.loading')}</Shimmer>
          </div>
        )}
        <iframe
          ref={frameRef}
          className="view-frame"
          src={src}
          title={title}
          sandbox="allow-scripts allow-forms"
          // Not `inert` once shown: assistive technology still reads a widget.
          tabIndex={surface === 'widget' ? -1 : undefined}
          inert={!ready}
        />
      </div>
      {scriptError && (
        <ToolCard.Footer tone="warning">
          <span className="min-w-0 truncate" title={scriptError.message ?? undefined}>
            {scriptError.message === null
              ? t('view.scriptError', { count: scriptError.count })
              : t('view.scriptErrorDetail', {
                  count: scriptError.count,
                  message: scriptError.message,
                })}
          </span>
        </ToolCard.Footer>
      )}
    </>
  );
}
