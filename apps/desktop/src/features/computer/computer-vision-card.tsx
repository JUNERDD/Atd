import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ModelSelection } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@atd/ui/components/item';
import { Popover, PopoverContent, PopoverTrigger } from '@atd/ui/components/popover';
import { Spinner } from '@atd/ui/components/spinner';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { showErrorToast } from '../../components/toast-store';
import { ModelList } from '../providers/model-list';

/** Shares the existing model catalog without changing the task's model or its context settings. */
export function ComputerVisionCard({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const settings = window.desktop?.settings;
  const value = snapshot?.computerVisionModel ?? null;
  const connections = (snapshot?.connections ?? []).map((connection) => ({
    ...connection,
    catalog: connection.catalog.filter((model) => model.input.includes('image')),
  }));
  const connection = connections.find((item) => item.connectionId === value?.connectionId);
  const model = connection?.catalog.find((item) => item.id === value?.modelId);
  const unavailable = value && snapshot?.providersLoaded && (!connection?.connected || !model);
  const label = value ? (model?.name ?? value.modelId) : t('computer.vision.followTask');

  async function choose(next: ModelSelection | null) {
    if (!settings || pending) return;
    setPending(true);
    setOpen(false);
    try {
      await settings.setComputerVisionModel(next);
    } catch (error) {
      showErrorToast(error);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card size="sm" className="settings-card">
      <ItemGroup>
        <Item asChild size="sm" className="settings-card-row">
          <li data-settings-anchor="computer-vision">
            <ItemContent className="min-w-[min(200px,100%)]">
              <ItemTitle className="whitespace-normal">{t('computer.vision.model')}</ItemTitle>
              <ItemDescription id="computer-vision-description" className="whitespace-normal">
                {t('computer.vision.description')}
              </ItemDescription>
              {unavailable && (
                <output className="text-xs text-muted-foreground">
                  {t('computer.vision.unavailable')}
                </output>
              )}
            </ItemContent>
            <ItemActions className="ml-auto max-w-full">
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="max-w-full"
                    disabled={!settings || !snapshot?.providersLoaded || pending}
                    aria-label={t('computer.vision.choose', { model: label })}
                    aria-describedby="computer-vision-description"
                    aria-busy={pending || undefined}
                  >
                    <span className="max-w-52 truncate" title={label}>
                      {label}
                    </span>
                    {pending ? <Spinner /> : <ChevronDown data-icon="inline-end" />}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  material="backdrop"
                  className="model-picker model-picker-scoped p-0"
                >
                  <ModelList
                    connections={connections}
                    value={value}
                    searchLabel={t('computer.vision.search')}
                    onSelect={(next) => void choose(next)}
                  />
                  <Button
                    variant="ghost"
                    className="m-2 shrink-0"
                    onClick={() => void choose(null)}
                  >
                    {t('computer.vision.followTask')}
                  </Button>
                </PopoverContent>
              </Popover>
            </ItemActions>
          </li>
        </Item>
      </ItemGroup>
    </Card>
  );
}
