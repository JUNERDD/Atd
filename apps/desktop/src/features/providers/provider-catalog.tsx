import { useRef, useState } from 'react';
import { SearchX } from 'lucide-react';
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
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@atd/ui/components/item';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { matchFields } from '@atd/ui/lib/fuzzy-match';
import { useCompositionQuery } from '@atd/ui/lib/ime';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import type { ProviderCatalogEntry } from '../../client/providers/schema';
import { SettingsHeading } from '../settings/settings-heading';
import { SettingsSearchField } from '../settings/settings-search-field';
import { ProviderBrand } from './provider-brand';

export function ProviderCatalog({
  catalog,
  onChoose,
}: {
  catalog: ProviderCatalogEntry[];
  onChoose: (provider: ProviderCatalogEntry) => void;
}) {
  const { t } = useTranslation('providers');
  const search = useCompositionQuery();
  const searchInput = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState('all');
  // Directory order stays; the search matches and marks the provider name the row shows.
  const visible = catalog.flatMap((provider) => {
    const inCategory =
      category === 'all' ||
      provider.category === category ||
      (category === 'api' && provider.auth.some((auth) => auth.type === 'api_key'));
    if (!inCategory) return [];
    const match = matchFields(search.query, { name: provider.name });
    return match || !search.query.trim() ? [{ provider, match }] : [];
  });
  return (
    <section className="provider-catalog settings-editor">
      <SettingsHeading
        title={t('catalog.title')}
        description={t('catalog.description')}
        subpage
        backLabel={t('catalog.back')}
      />
      <div className="settings-overview-toolbar">
        <SettingsSearchField
          ref={searchInput}
          search={search}
          aria-label={t('catalog.searchLabel')}
          placeholder={t('catalog.searchPlaceholder')}
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger aria-label={t('catalog.categoryLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('catalog.category.all')}</SelectItem>
            <SelectItem value="accounts">{t('catalog.category.accounts')}</SelectItem>
            <SelectItem value="api">{t('catalog.category.api')}</SelectItem>
            <SelectItem value="cloud">{t('catalog.category.cloud')}</SelectItem>
            <SelectItem value="local">{t('catalog.category.local')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <ScrollArea
        className="settings-page-scroll"
        aria-label={t('catalog.available')}
        gutter="none"
        scrollShadow
      >
        <div className="settings-editor-inner">
          {!visible.length &&
            (search.query.trim() ? (
              <Empty className="px-4 py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SearchX />
                  </EmptyMedia>
                  <EmptyTitle>
                    {t('catalog.noMatchesTitle', { query: search.query.trim() })}
                  </EmptyTitle>
                  <EmptyDescription>{t('catalog.noMatchesDescription')}</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    variant="outline"
                    onClick={() => {
                      search.change('');
                      searchInput.current?.focus();
                    }}
                  >
                    {t('catalog.clearSearch')}
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              // Only a category can empty the list without a search; All providers restores it.
              <Empty className="px-4 py-8">
                <EmptyHeader>
                  <EmptyTitle>{t('catalog.empty')}</EmptyTitle>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" onClick={() => setCategory('all')}>
                    {t('catalog.category.all')}
                  </Button>
                </EmptyContent>
              </Empty>
            ))}
          <ul className="provider-directory">
            {visible.map(({ provider, match }) => {
              const methods = provider.auth.map((method) => method.label).join(' · ');
              return (
                <li key={provider.id} className="provider-directory-cell">
                  <Item variant="outline" size="sm" asChild>
                    <button
                      type="button"
                      className="provider-directory-card"
                      onClick={() => onChoose(provider)}
                    >
                      <ItemMedia>
                        <ProviderBrand provider={provider.id} />
                      </ItemMedia>
                      <ItemContent className="gap-0.5">
                        <ItemTitle title={provider.name}>
                          <HighlightedText text={provider.name} ranges={match?.ranges.name} />
                        </ItemTitle>
                        <ItemDescription className="text-xs">{methods}</ItemDescription>
                      </ItemContent>
                    </button>
                  </Item>
                </li>
              );
            })}
          </ul>
        </div>
      </ScrollArea>
    </section>
  );
}
