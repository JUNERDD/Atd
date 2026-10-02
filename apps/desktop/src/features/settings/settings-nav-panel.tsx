import { useRef, type KeyboardEvent } from 'react';
import { Search, SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@atd/ui/components/empty';
import { HighlightedText } from '@atd/ui/components/highlighted-text';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { isComposingKey, useCompositionQuery } from '@atd/ui/lib/ime';
import { revealSettingsAnchor } from './reveal-settings-anchor';
import { SettingsSearchField } from './settings-search-field';
import { settingsSections, type SettingsSectionId } from './settings-sections';
import { useSettingsSearch, type SettingsSearchResult } from './use-settings-search';

/** Keys that move focus between the navigation rows, whether they stack or wrap into rows. */
const STEP: Partial<Record<string, 1 | -1>> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

/**
 * The settings search field above the section list, shared by the sidebar, the compact bar and
 * the drawer. Without a query the card lists the sections. With one, it lists the sections and
 * settings that match, best first, each opening its section and revealing the setting; Enter opens
 * the best match, and the arrow keys move from the field into the results and between them. The
 * list is one tab stop: Tab enters it at the shown section, or at the best match while searching.
 */
export function SettingsNavPanel({
  current,
  disabled,
  onNavigate,
}: {
  current: SettingsSectionId;
  /** While a shortcut is being recorded, navigating away would drop the capture. */
  disabled: boolean;
  /** Shows a section; `then` runs once it is shown (see `SettingsNavigationContext`). */
  onNavigate: (section: SettingsSectionId, then?: () => void) => void;
}) {
  const { t } = useTranslation('settings');
  const search = useCompositionQuery();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLElement>(null);
  const results = useSettingsSearch(search.query);
  const query = search.query.trim();
  const searching = query !== '';

  const rows = () => [...(list.current?.querySelectorAll('button') ?? [])];

  function open(result: SettingsSearchResult) {
    // A control outside every section (the language selector) stays on the current page; the
    // navigation still runs so the drawer closes.
    onNavigate(result.section ?? current, () => {
      search.change('');
      revealSettingsAnchor(result.entry.anchor);
      // The result row unmounts with the query; without a control to focus, keep focus in the card.
      if (!result.entry.anchor) {
        requestAnimationFrame(() => {
          list.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
        });
      }
    });
  }

  function clearSearch() {
    search.change('');
    input.current?.focus();
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (isComposingKey(event)) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      rows()[0]?.focus();
    } else if (event.key === 'Enter' && searching && results[0]) {
      event.preventDefault();
      open(results[0]);
    }
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const buttons = rows();
    const index = buttons.indexOf(event.currentTarget);
    const step = STEP[event.key];
    let target: HTMLElement | undefined;
    if (step === -1 && index === 0) target = input.current ?? undefined;
    else if (step) target = buttons[index + step];
    else if (event.key === 'Home') target = buttons[0];
    else if (event.key === 'End') target = buttons.at(-1);
    else return;
    event.preventDefault();
    target?.focus();
  }

  return (
    <>
      <SettingsSearchField
        ref={input}
        search={search}
        className="settings-search"
        aria-label={t('search.label')}
        placeholder={t('search.placeholder')}
        disabled={disabled}
        onKeyDown={onSearchKeyDown}
      />
      <output className="sr-only" aria-live="polite">
        {searching &&
          (results.length
            ? t('search.resultCount', { count: results.length })
            : t('search.noResults', { query }))}
      </output>
      <ScrollArea
        className="settings-nav-scroll"
        gutter="none"
        scrollShadow
        data-searching={searching || undefined}
      >
        <nav
          ref={list}
          className="settings-navigation"
          aria-label={t('nav.label')}
          data-searching={searching || undefined}
        >
          {searching
            ? results.map((result, index) => {
                const Icon =
                  result.entry.icon ??
                  settingsSections.find(({ id }) => id === result.section)?.icon ??
                  Search;
                return (
                  <Button
                    key={result.entry.id}
                    variant="ghost"
                    className="settings-nav-button settings-result-button"
                    aria-current={
                      result.isSection && current === result.section ? 'page' : undefined
                    }
                    data-best-match={index === 0 ? '' : undefined}
                    tabIndex={index === 0 ? 0 : -1}
                    disabled={disabled}
                    onClick={() => open(result)}
                    onKeyDown={onRowKeyDown}
                  >
                    <Icon aria-hidden="true" />
                    <span className="settings-result-text">
                      <span className="settings-nav-label">
                        <HighlightedText text={result.label} ranges={result.match?.ranges.label} />
                      </span>
                      <span className="settings-result-secondary">{result.secondary}</span>
                    </span>
                  </Button>
                );
              })
            : settingsSections.map(({ id, labelKey, icon: Icon }) => (
                <Button
                  key={id}
                  variant="ghost"
                  className="settings-nav-button"
                  aria-current={current === id ? 'page' : undefined}
                  tabIndex={current === id ? 0 : -1}
                  disabled={disabled}
                  onClick={() => onNavigate(id)}
                  onKeyDown={onRowKeyDown}
                >
                  <Icon aria-hidden="true" />
                  {/* The hidden bold copy reserves the selected row's width (`settings.css`). */}
                  <span className="settings-nav-label" data-label={t(labelKey)}>
                    <span>{t(labelKey)}</span>
                  </span>
                </Button>
              ))}
        </nav>
        {searching && results.length === 0 && (
          <Empty className="settings-nav-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyTitle className="settings-nav-empty-title">
                {t('search.noResults', { query })}
              </EmptyTitle>
              <EmptyDescription>{t('search.noResultsHint')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={clearSearch}>
                {t('search.clear')}
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </ScrollArea>
    </>
  );
}
