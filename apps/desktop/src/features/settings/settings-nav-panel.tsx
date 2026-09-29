import { useRef, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@ai/ui/components/input-group';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { isComposingKey, useCompositionQuery } from '@ai/ui/lib/ime';
import { rankByQuery } from '@ai/ui/lib/fuzzy-match';
import { settingsSections, type SettingsSectionId } from './settings-sections';

/** Keys that move focus between the navigation rows, whether they stack or wrap into rows. */
const STEP: Partial<Record<string, 1 | -1>> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

/**
 * The settings search field above the section list, shared by the sidebar, the compact bar and
 * the drawer. The search filters and ranks the destinations by name; Enter opens the best match,
 * and the arrow keys move from the field into the results and between them.
 */
export function SettingsNavPanel({
  current,
  disabled,
  onNavigate,
}: {
  current: SettingsSectionId;
  /** While a shortcut is being recorded, navigating away would drop the capture. */
  disabled: boolean;
  onNavigate: (section: SettingsSectionId) => void;
}) {
  const { t } = useTranslation('settings');
  const search = useCompositionQuery();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLElement>(null);
  const results = rankByQuery(settingsSections, search.query, (section) => ({
    label: t(section.labelKey),
  }));
  const searching = search.query.trim() !== '';

  const rows = () => [...(list.current?.querySelectorAll('button') ?? [])];

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (isComposingKey(event)) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      rows()[0]?.focus();
    } else if (event.key === 'Enter' && searching && results[0]) {
      event.preventDefault();
      onNavigate(results[0].item.id);
    } else if (event.key === 'Escape' && search.text) {
      event.stopPropagation();
      search.change('');
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
      <InputGroup className="settings-search" data-disabled={disabled || undefined}>
        <InputGroupInput
          ref={input}
          aria-label={t('search.label')}
          placeholder={t('search.placeholder')}
          value={search.text}
          disabled={disabled}
          onChange={(event) => search.change(event.target.value)}
          onKeyDown={onSearchKeyDown}
          {...search.compositionProps}
        />
        <InputGroupAddon>
          <Search aria-hidden="true" />
        </InputGroupAddon>
      </InputGroup>
      <ScrollArea className="settings-nav-scroll" gutter="none">
        <nav ref={list} className="settings-navigation" aria-label={t('nav.label')}>
          {results.map(({ item: { id, labelKey, icon: Icon }, match }, index) => (
            <Button
              key={id}
              variant="ghost"
              className="settings-nav-button"
              aria-current={current === id ? 'page' : undefined}
              data-best-match={searching && index === 0 ? '' : undefined}
              disabled={disabled}
              onClick={() => onNavigate(id)}
              onKeyDown={onRowKeyDown}
            >
              <Icon aria-hidden="true" />
              <span className="settings-nav-label">
                <HighlightedText text={t(labelKey)} ranges={match?.ranges.label} />
              </span>
            </Button>
          ))}
          {results.length === 0 && (
            <output className="settings-nav-empty">{t('search.empty')}</output>
          )}
        </nav>
      </ScrollArea>
    </>
  );
}
