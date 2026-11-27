import { useCallback, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FLAVORS } from '../../flavors.ts';
import { buildDiagEvent, summarizeError } from '../diagnostics/sanitize.ts';
import { FLAVOR } from '../flavor.ts';
import { PageErrorBoundary } from '../pages/error-boundary.tsx';
import { channelBlock } from '../pages/link.ts';
import { useAtdLanguage } from '../pages/use-atd-language.ts';
import { AtdGroup } from './atd-group.tsx';
import { ShortcutsGroup } from './shortcuts-group.tsx';
import { SitesGroup } from './sites-group.tsx';
import { ToolbarGroup } from './toolbar-group.tsx';
import { useOptionsChannel } from './use-options-channel.ts';

/**
 * The extension's name for this flavor, as Chrome lists it (in Chrome's language, like its
 * extension and shortcut pages, where the person looks for it).
 */
const NAME = chrome.i18n.getMessage(FLAVORS[FLAVOR].nameMessage);
const VERSION = chrome.runtime.getManifest().version;

/** The tab's title, once the language is known; until then it keeps the document's own. */
function useDocumentTitle(title: string | null) {
  useLayoutEffect(() => {
    if (title) document.title = title;
  }, [title]);
}

/** Until the first state arrives: a spinner that appears only if it takes a while. */
function Loading() {
  const { t } = useTranslation('options');
  return (
    <output className="op-loading">
      <span className="activity-indicator" aria-hidden="true" />
      <span className="sr-only">{t('loading')}</span>
    </output>
  );
}

/**
 * The extension's own settings page, which Chrome opens in a tab (`options_ui`), laid out as a
 * macOS System Settings pane: what the toolbar button does, the command shortcuts Chrome keeps,
 * the websites the person allowed, and the connection to Atd. The background owns every state and
 * side effect; the page renders its latest view and sends intents.
 */
export function Options() {
  const { view, send } = useOptionsChannel();
  const { t } = useTranslation('options');
  useAtdLanguage(view?.prefs.language ?? null);
  useDocumentTitle(view ? t('title', { name: NAME }) : null);
  const onRenderError = useCallback(
    (error: Error) => {
      send(
        buildDiagEvent(
          'error',
          'react',
          summarizeError(error, 'Options render error'),
          'render_error',
        ),
      );
    },
    [send],
  );
  return (
    <PageErrorBoundary
      className="op-page"
      fallbackMessage={t('errorFallback')}
      onError={onRenderError}
    >
      <main className="op-page">
        {view ? (
          <>
            <header className="op-header">
              <span className="atd-mark op-mark" aria-hidden="true" />
              <h1 className="op-title">{NAME}</h1>
            </header>
            <ToolbarGroup view={view} send={send} />
            <ShortcutsGroup shortcuts={view.shortcuts} name={NAME} send={send} />
            <SitesGroup sites={view.sites} block={channelBlock(view)} send={send} />
            <AtdGroup view={view} send={send} />
            <p className="op-version">{t('version', { version: VERSION })}</p>
          </>
        ) : (
          <Loading />
        )}
      </main>
    </PageErrorBoundary>
  );
}
