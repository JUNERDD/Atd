import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { commandFilter } from '@ai/ui/components/command';
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
        title="Add provider"
        description="Choose how to connect your models."
        onBack={onBack}
        backLabel="Back to providers"
      />
      <div className="settings-overview-toolbar">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search provider catalog"
          placeholder="Search providers…"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger aria-label="Provider category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            <SelectItem value="accounts">Account login</SelectItem>
            <SelectItem value="api">API keys</SelectItem>
            <SelectItem value="cloud">Cloud services</SelectItem>
            <SelectItem value="local">Local and custom</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <ScrollArea className="settings-editor-body" aria-label="Available providers">
        <div className="settings-editor-inner provider-directory">
          {!visible.length && (
            <p className="text-sm text-muted-foreground py-6">No matching providers</p>
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
