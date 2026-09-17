import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { commandFilter } from '@ai/ui/lib/command-filter';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import type { ProviderCatalogEntry } from '../../../electron/providers/schema';
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
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const visible = catalog.filter(
    (provider) =>
      (category === 'all' ||
        provider.category === category ||
        (category === 'api' && provider.auth.some((auth) => auth.type === 'api_key'))) &&
      commandFilter(`${provider.name} ${provider.id}`, query.trim()) > 0,
  );
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
          value={query}
          onChange={(event) => setQuery(event.target.value)}
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
      <ScrollArea className="settings-editor-body" aria-label={t('catalog.available')} gutter>
        <div className="settings-editor-inner provider-directory">
          {!visible.length && (
            <p className="text-sm text-muted-foreground py-6">{t('catalog.empty')}</p>
          )}
          {visible.map((provider) => (
            <Button
              key={provider.id}
              variant="ghost"
              className="provider-directory-row"
              onClick={() => onChoose(provider)}
            >
              <ProviderBrand provider={provider.id} />
              <div className="min-w-0 flex-1 text-left">
                <p className="font-medium truncate" title={provider.name}>
                  {provider.name}
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
