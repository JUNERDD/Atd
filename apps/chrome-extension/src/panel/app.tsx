import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { OwnInput } from '../channel/payloads.ts';
import type { PanelMessage } from '../messages/panel.ts';
import type { PanelView } from '../messages/views.ts';
import { linkStatus, shellAnswers } from '../pages/link.ts';
import { useAtdLanguage } from '../pages/use-atd-language.ts';
import { Composer } from './composer.tsx';
import { ConnectView } from './connect-view.tsx';
import { EmptyState } from './empty-state.tsx';
import { composeBlock, reachOf, screenFor, siteOf, type ActivePage } from './model.ts';
import { NoticeView } from './notice-view.tsx';
import { RunsGroup } from './runs-group.tsx';
import { SURFACE } from './surface.ts';
import { PanelToolbar } from './toolbar.tsx';
import { useActivePage } from './use-active-page.ts';
import { useOwnInput } from './use-own-input.ts';
import { usePanelChannel, type PanelChannel } from './use-panel-channel.ts';

type Act = (message: PanelMessage, options?: { close: boolean }) => void;

/**
 * Esc dismisses the popup, as it does a Mac popover, unless it closes the open menu first; the
 * side panel stays until it is closed.
 */
function useCloseOnEscape() {
  useEffect(() => {
    if (SURFACE !== 'popup') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector(':popover-open')) window.close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

/**
 * True from the first frame after a view was shown: runs that arrive later (the request just
 * sent) settle in, while the ones the panel opened with are simply there.
 */
function useSettled(loaded: boolean): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!loaded || settled) return;
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, [loaded, settled]);
  return settled;
}

/**
 * The panel's content between its toolbar and its composer: it scrolls, with the kit's scroll
 * edge where content continues under either (no dividers), and centers an empty state in its
 * free space.
 */
function Body({ settled = false, children }: { settled?: boolean; children: ReactNode }) {
  return (
    <main className="pp-body" data-settled={settled || undefined}>
      <div className="scroll-edge-top" aria-hidden="true" />
      <div className="pp-content">{children}</div>
      <div className="scroll-edge-bottom" aria-hidden="true" />
    </main>
  );
}

/** Until the first state arrives: a spinner that appears only if it takes a while. */
function Loading() {
  const { t } = useTranslation('panel');
  return (
    <output className="pp-loading">
      <span className="activity-indicator" aria-hidden="true" />
      <span className="sr-only">{t('loading')}</span>
    </output>
  );
}

interface MainProps {
  view: PanelView;
  settled: boolean;
  page: ActivePage;
  act: Act;
  channel: PanelChannel;
  takeOwnInput: () => OwnInput | undefined;
}

/**
 * Paired: what runs in this browser (or, before anything has, what the panel is for and where the
 * in-page ask is), then the composer, kept in view at the bottom.
 */
function MainView({ view, settled, page, act, channel, takeOwnInput }: MainProps) {
  const { t } = useTranslation('panel');
  return (
    <>
      <Body settled={settled}>
        {view.runs.length > 0 ? (
          <RunsGroup runs={view.runs} reach={reachOf(view)} send={act} />
        ) : (
          <EmptyState title={t('empty.title')} body={t('empty.body')}>
            {view.askShortcut ? (
              <p className="pp-tip">{t('empty.shortcut', { shortcut: view.askShortcut })}</p>
            ) : null}
          </EmptyState>
        )}
      </Body>
      <Composer
        page={page}
        block={composeBlock(view, page)}
        channel={channel}
        takeOwnInput={takeOwnInput}
      />
    </>
  );
}

/**
 * The extension's panel (decision 10), laid out as a Mac sidebar: a toolbar with the connection
 * and the More menu, the runs in this browser, and the composer that sends a request to Atd from
 * the tab the window shows. Before pairing, or while Atd cannot be reached, the content is one
 * explanation and the step that may help. The background owns every state and side effect; the
 * panel renders its latest view, follows the active tab itself, and sends intents. As the toolbar
 * popup, choices that move the person elsewhere (a tab, Atd) close it; the side panel stays beside
 * the tabs.
 */
export function Panel() {
  const channel = usePanelChannel();
  const { view, send } = channel;
  const page = useActivePage();
  const takeOwnInput = useOwnInput();
  useAtdLanguage(view?.prefs.language ?? null);
  useCloseOnEscape();
  const act = useCallback<Act>(
    (message, options) => {
      send(message);
      if (options?.close && SURFACE === 'popup') window.close();
    },
    [send],
  );
  const loaded = view !== null && page.kind !== 'loading' ? view : null;
  const screen = loaded ? screenFor(loaded) : null;
  const settled = useSettled(loaded !== null);
  return (
    <>
      <PanelToolbar
        status={loaded ? linkStatus(loaded, reachOf(loaded)) : null}
        site={loaded ? siteOf(loaded, page) : null}
        shellEnabled={loaded ? shellAnswers(loaded) : false}
        onChoose={act}
      />
      {!loaded || !screen ? (
        <Body>
          <Loading />
        </Body>
      ) : screen.kind === 'main' ? (
        <MainView
          view={loaded}
          settled={settled}
          page={page}
          act={act}
          channel={channel}
          takeOwnInput={takeOwnInput}
        />
      ) : (
        <Body>
          {screen.kind === 'notice' ? (
            <NoticeView notice={screen.notice} send={act} />
          ) : (
            <ConnectView pairing={loaded.pairing} profileLabel={loaded.profileLabel} send={act} />
          )}
        </Body>
      )}
    </>
  );
}
