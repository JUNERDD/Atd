import type { AppLanguage } from '@atd/agent-contracts';
import { useCallback, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FLAVOR } from '../flavor.ts';
import { documentLanguage } from '../i18n/create.ts';
import type { PopupMessage } from '../messages/popup.ts';
import type { PopupView } from '../messages/views.ts';
import { ConnectView } from './connect-view.tsx';
import { PopupHeader } from './header.tsx';
import { MenuActions } from './menu-actions.tsx';
import {
  askBlock,
  channelBlock,
  linkStatus,
  reachOf,
  screenFor,
  shellAnswers,
  type ActivePage,
} from './model.ts';
import { NoticeView } from './notice-view.tsx';
import { PageGroup } from './page-group.tsx';
import { RunsGroup } from './runs-group.tsx';
import { useActivePage } from './use-active-page.ts';
import { usePopupChannel } from './use-popup-channel.ts';

type Act = (message: PopupMessage, options?: { close: boolean }) => void;

/**
 * Follows Atd's language setting (D13) in the copy and in `<html lang>`. A layout effect, so the
 * first state never paints in the start-up language: the bundled resources switch synchronously.
 */
function useAtdLanguage(language: AppLanguage | null) {
  const { i18n } = useTranslation('popup');
  useLayoutEffect(() => {
    if (!language) return;
    document.documentElement.lang = documentLanguage(language);
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [i18n, language]);
}

/** Esc dismisses the popup, as it does a Mac popover. */
function useCloseOnEscape() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') window.close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

/** Until the first state arrives: the title row and a spinner that appears only if it takes a while. */
function Loading() {
  const { t } = useTranslation('popup');
  return (
    <output className="pp-loading">
      <span className="activity-indicator" aria-hidden="true" />
      <span className="sr-only">{t('loading')}</span>
    </output>
  );
}

/** Paired: what runs in this browser, then this page. */
function MainView({ view, page, act }: { view: PopupView; page: ActivePage; act: Act }) {
  const reach = reachOf(view);
  return (
    <>
      <RunsGroup runs={view.runs} reach={reach} send={act} />
      <PageGroup
        page={page}
        sites={view.sites}
        block={askBlock(view, page)}
        shortcut={view.askShortcut}
        siteBlock={channelBlock(view)}
        send={act}
      />
    </>
  );
}

function Body({ view, page, act }: { view: PopupView; page: ActivePage; act: Act }) {
  const screen = screenFor(view);
  switch (screen.kind) {
    case 'notice':
      return <NoticeView notice={screen.notice} send={act} />;
    case 'connect':
      return <ConnectView pairing={view.pairing} profileLabel={view.profileLabel} send={act} />;
    case 'main':
      return <MainView view={view} page={page} act={act} />;
  }
}

/**
 * The toolbar popup (decision 10): status and control only. The background owns every state and
 * side effect; the popup renders its latest view, reads the active tab itself, and sends intents.
 * Choices that move the person elsewhere (a tab, the in-page ask, Atd) close the popup.
 */
export function Popup() {
  const { view, send } = usePopupChannel();
  const page = useActivePage();
  useAtdLanguage(view?.prefs.language ?? null);
  useCloseOnEscape();
  const act = useCallback<Act>(
    (message, options) => {
      send(message);
      if (options?.close) window.close();
    },
    [send],
  );
  const loaded = view !== null && page.kind !== 'loading';
  return (
    <>
      <PopupHeader status={loaded ? linkStatus(view) : null} dev={FLAVOR === 'dev'} />
      {loaded ? (
        <>
          <Body view={view} page={page} act={act} />
          <MenuActions
            enabled={shellAnswers(view)}
            onChoose={(message) => act(message, { close: true })}
          />
        </>
      ) : (
        <Loading />
      )}
    </>
  );
}
