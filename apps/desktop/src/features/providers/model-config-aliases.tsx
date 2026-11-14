import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { MAX_MODEL_ALIAS_NAME_LENGTH, type ModelAlias } from '@atd/agent-contracts';
import { BookmarkPlus, Check, Cpu, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Input } from '@atd/ui/components/input';
import { Kbd, KbdGroup } from '@atd/ui/components/kbd';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { Separator } from '@atd/ui/components/separator';
import type { Connection } from '../../client/providers/schema';
import { shortcutKeys } from '../../lib/shortcuts';
import { formatAliasTupleSummary, isAliasAvailable } from '../agent/use-panel-aliases';
import { ProviderBrand } from './provider-brand';
import { providerPresentation } from './provider-services';

export interface ModelConfigAliasesProps {
  aliases: ModelAlias[];
  connections: Connection[];
  activeAlias: ModelAlias | null;
  aliasModified: boolean;
  cycleShortcut?: string | undefined;
  onSelectAlias: (alias: ModelAlias) => void;
  onRestoreAlias?: (() => void) | undefined;
  onSaveAsAlias?: ((name: string) => Promise<void>) | undefined;
  onClosePopover: () => void;
}

function brandForConnection(connection: Connection | undefined) {
  if (!connection) return null;
  return providerPresentation(connection)?.service.brand ?? connection.provider;
}

/**
 * Pinned quick-switch list of user-configured model aliases rendered at the top of the Composer
 * `ModelConfigPopover` root view, with inline Restore and Save-as-new controls when modified.
 */
export function ModelConfigAliases({
  aliases,
  connections,
  activeAlias,
  aliasModified,
  cycleShortcut,
  onSelectAlias,
  onRestoreAlias,
  onSaveAsAlias,
  onClosePopover,
}: ModelConfigAliasesProps) {
  const { t } = useTranslation('panel');
  const { t: tProviders } = useTranslation('providers');
  const [saveOpen, setSaveOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const platform = window.desktop?.platform ?? 'web';
  const keys = cycleShortcut ? shortcutKeys(cycleShortcut, platform) : [];

  function openSaveForm() {
    setDraftName(activeAlias ? `${activeAlias.name} (${t('aliases.copySuffix')})` : '');
    setError(null);
    setSaveOpen(true);
    requestAnimationFrame(() => nameInputRef.current?.focus());
  }

  function closeSaveForm() {
    setSaveOpen(false);
    setDraftName('');
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSaveAsAlias || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSaveAsAlias(draftName);
      closeSaveForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aliases.saveFailed'));
    }
    setSubmitting(false);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeSaveForm();
  }

  return (
    <>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2 px-2.5 pt-1 pb-0.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t('aliases.sectionTitle')}
          </span>
          {keys.length > 0 && (
            <KbdGroup aria-hidden="true">
              {keys.map((key, index) => (
                <Kbd key={`${index}-${key}`}>{key}</Kbd>
              ))}
            </KbdGroup>
          )}
        </div>
        <ScrollArea className="max-h-48">
          <div className="flex flex-col gap-0.5">
            {aliases.map((alias) => {
              const connection = connections.find(
                (item) => item.connectionId === alias.connectionId,
              );
              const available = isAliasAvailable(alias, connections);
              const selected = activeAlias?.id === alias.id && !aliasModified;
              const summary = formatAliasTupleSummary(alias, connections, tProviders);
              const brand = brandForConnection(connection);
              return (
                <button
                  key={alias.id}
                  type="button"
                  disabled={!available}
                  aria-pressed={selected}
                  data-checked={selected}
                  title={
                    available
                      ? `${alias.name} · ${summary}`
                      : t('aliases.offlineHint', {
                          provider: connection?.name ?? alias.connectionId,
                        })
                  }
                  className="model-config-effort-option w-full disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => {
                    onSelectAlias(alias);
                    onClosePopover();
                  }}
                >
                  {brand ? (
                    <ProviderBrand provider={brand} />
                  ) : (
                    <Cpu className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate font-medium text-foreground">{alias.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {available ? summary : t('aliases.providerOffline', { summary })}
                    </span>
                  </span>
                  {selected ? (
                    <Check className="size-4 shrink-0" />
                  ) : (
                    <span className="size-4 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </ScrollArea>
        {activeAlias && aliasModified && (
          <div className="mt-1 flex flex-col gap-1.5 border-t border-border/60 px-2 pt-2 pb-1">
            {saveOpen ? (
              <form
                className="flex flex-col gap-1.5"
                onSubmit={(event) => void handleSubmit(event)}
              >
                <Input
                  ref={nameInputRef}
                  maxLength={MAX_MODEL_ALIAS_NAME_LENGTH}
                  value={draftName}
                  disabled={submitting}
                  placeholder={t('aliases.namePlaceholder')}
                  aria-label={t('aliases.namePlaceholder')}
                  onChange={(event) => setDraftName(event.target.value)}
                  onKeyDown={handleInputKeyDown}
                />
                {error && <p className="text-xs text-destructive">{error}</p>}
                <div className="flex items-center justify-end gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={submitting}
                    onClick={closeSaveForm}
                  >
                    {t('aliases.cancel')}
                  </Button>
                  <Button type="submit" size="xs" disabled={submitting || !draftName.trim()}>
                    {t('aliases.save')}
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <p className="px-0.5 text-xs text-muted-foreground">
                  {t('aliases.modifiedStatus', { name: activeAlias.name })}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {onRestoreAlias && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="h-7 flex-1 justify-start truncate"
                      onClick={onRestoreAlias}
                    >
                      <RotateCcw className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {t('aliases.restore', { name: activeAlias.name })}
                      </span>
                    </Button>
                  )}
                  {onSaveAsAlias && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      className="h-7 shrink-0"
                      onClick={openSaveForm}
                    >
                      <BookmarkPlus className="size-3.5 shrink-0" />
                      <span>{t('aliases.saveAsNew')}</span>
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <Separator className="my-1" />
    </>
  );
}
