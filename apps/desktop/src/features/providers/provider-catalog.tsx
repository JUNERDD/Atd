import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import { Input } from '@ai/ui/components/input';
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
  onBack,
}: {
  catalog: ProviderCatalogEntry[];
  onChoose: (provider: ProviderCatalogEntry) => void;
  onBack: () => void;
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
        onBack={onBack}
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
        <div className="settings-editor-inner provider-directory">
          {!visible.length && (
            <p className="text-sm text-muted-foreground py-6">{t('catalog.empty')}</p>
          )}
          {visible.map(({ provider, match }) => (
            <Button
              key={provider.id}
              variant="ghost"
              className="provider-directory-row"
              onClick={() => onChoose(provider)}
            >
              <ProviderBrand provider={provider.id} />
              <div className="min-w-0 flex-1 text-left">
                <p className="font-medium truncate" title={provider.name}>
                  <HighlightedText text={provider.name} ranges={match?.ranges.name} />
                </p>
                <p
                  className="text-muted-foreground font-normal truncate"
                  title={provider.auth.map((method) => method.label).join(' · ')}
                >
                  {provider.auth.map((method) => method.label).join(' · ')}
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0" />
            </Button>
          ))}
        </div>
      </ScrollArea>
    </section>
  );
}
