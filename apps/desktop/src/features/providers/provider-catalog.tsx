import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import { Input } from '@ai/ui/components/input';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@ai/ui/components/item';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { matchFields } from '@ai/ui/lib/fuzzy-match';
import { useCompositionQuery } from '@ai/ui/lib/ime';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import type { ProviderCatalogEntry } from '../../client/providers/schema';
import { SettingsHeading } from '../settings/settings-heading';
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
        <Input
          value={search.text}
          onChange={(event) => search.change(event.target.value)}
          {...search.compositionProps}
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
        className="flex-1 min-h-0 min-w-0 m-[-3px_-15px_-3px_-3px]"
        aria-label={t('catalog.available')}
        gutter="stable"
      >
        <div className="settings-editor-inner">
          {!visible.length && (
            <p className="text-sm text-muted-foreground py-6">{t('catalog.empty')}</p>
          )}
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
