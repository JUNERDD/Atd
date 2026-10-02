import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';
import { Input } from '@atd/ui/components/input';
import { Label } from '@atd/ui/components/label';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import type { Connection, ProviderCatalogEntry } from '../../client/providers/schema';
import { CLOUD_FIELDS, isCustom, isAmbient } from '../../client/providers/metadata';
import { showErrorToast, showToast } from '../../components/toast-store';
import { useOverlayFooter } from '../../components/use-overlay-footer';
import { SettingsHeading } from '../settings/settings-heading';
import { CustomModels } from './custom-models';
import { ProviderSignIn } from './provider-login';
import { draftFrom } from './provider-draft';
import { useProviderDraft } from './use-provider-draft';
export function ProviderForm({
  provider,
  connection,
  onSaved,
  onBack,
}: {
  provider: ProviderCatalogEntry;
  connection: Connection | null;
  onSaved: (connection: Connection) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation('providers');
  const { draft, change, load } = useProviderDraft(provider, connection);
  const [pending, setPending] = useState('');
  const footerRef = useOverlayFooter<HTMLElement>();
  const bridge = window.desktop?.settings.providers;
  const disabled = Boolean(pending) || !bridge;
  const custom = isCustom(draft.provider);
  const cloud = isAmbient(draft.provider);
  const saved = connection && connection.connectionId === draft.connectionId ? connection : null;
  const options =
    provider.auth.length && cloud && !provider.auth.some((auth) => auth.type === 'api_key')
      ? [...provider.auth, { type: 'api_key' as const, label: t('form.authFallback') }]
      : provider.auth;
  const verifyBlocked = disabled || !saved?.connected || !saved.defaultModel;
  async function perform(label: string, operation: () => Promise<void>) {
    setPending(label);
    try {
      await operation();
    } catch (error) {
      showErrorToast(error);
    }
    setPending('');
  }
  async function save() {
    if (!bridge) return;
    await perform('saving', async () => {
      const result = await bridge.save(draft);
      load(draftFrom(result));
      // Leaves through `replace`, which never asks about unsaved changes.
      onSaved(result);
      showToast({ kind: 'info', text: t('form.saved') });
    });
  }
  return (
    <section className="provider-form settings-editor" aria-label={t('form.sectionLabel')}>
      <SettingsHeading
        title={saved ? draft.name : t('form.connect', { name: provider.name })}
        subpage
        backLabel={t('form.back')}
      />
      <ScrollArea
        className="m-[-3px_-15px_-3px_-3px] min-h-0 min-w-0 flex-1"
        viewportClassName="overlay-footer-fade"
        gutter="stable"
        scrollShadow
      >
        <div className="settings-editor-inner settings-fields">
          {saved && saved.revision !== draft.expectedRevision && (
            <output className="settings-field-note">
              {t('form.conflict')}{' '}
              <Button size="xs" variant="outline" onClick={() => load(draftFrom(saved))}>
                {t('form.reload')}
              </Button>
            </output>
          )}
          <fieldset disabled={disabled} className="settings-fields">
            <div className="settings-field">
              <Label htmlFor="provider-name">{t('form.name')}</Label>
              <Input
                id="provider-name"
                value={draft.name}
                maxLength={120}
                onChange={(event) => change({ name: event.target.value })}
              />
            </div>
            <div className="settings-field">
              <Label htmlFor="provider-auth">{t('form.auth')}</Label>
              <Select
                value={draft.authType}
                disabled={Boolean(saved)}
                onValueChange={(value) => {
                  const method = options.find((auth) => auth.type === value);
                  if (method) change({ authType: method.type, apiKey: undefined });
                }}
              >
                <SelectTrigger id="provider-auth">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((method) => (
                    <SelectItem key={method.type} value={method.type}>
                      {method.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {draft.authType === 'api_key' && (
              <div className="settings-field">
                <div className="settings-field-label">
                  <Label htmlFor="provider-api-key">{t('form.apiKey')}</Label>
                  {saved?.hasCredential && (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => change({ apiKey: draft.apiKey === '' ? undefined : '' })}
                    >
                      {draft.apiKey === '' ? t('form.keepKey') : t('form.removeKey')}
                    </Button>
                  )}
                </div>
                <Input
                  id="provider-api-key"
                  type="password"
                  value={draft.apiKey ?? ''}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder={
                    saved?.hasCredential
                      ? t('form.keepKeyPlaceholder')
                      : t('form.apiKeyPlaceholder')
                  }
                  onChange={(event) => change({ apiKey: event.target.value })}
                />
                <p className="settings-field-note">
                  {draft.apiKey === '' && saved?.hasCredential
                    ? t('form.keyRemovedNote')
                    : t('form.encryptedNote')}
                </p>
              </div>
            )}
            {(custom || draft.provider === 'azure-openai-responses' || draft.baseUrl) && (
              <div className="settings-field">
                <Label htmlFor="provider-endpoint">
                  {draft.provider === 'azure-openai-responses'
                    ? t('form.resourceEndpoint')
                    : t('form.baseUrl')}
                </Label>
                <Input
                  id="provider-endpoint"
                  type="url"
                  value={draft.baseUrl}
                  readOnly={!custom && draft.provider !== 'azure-openai-responses'}
                  onChange={(event) => change({ baseUrl: event.target.value })}
                  placeholder="https://your-provider.example/v1"
                />
              </div>
            )}
            {(CLOUD_FIELDS[draft.provider] ?? []).map((field) => (
              <div className="settings-field" key={field.key}>
                <Label htmlFor={field.key}>{field.label}</Label>
                <Input
                  id={field.key}
                  value={draft.options[field.key] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    change({ options: { ...draft.options, [field.key]: event.target.value } })
                  }
                />
              </div>
            ))}
            {draft.authType === 'ambient' && (
              <p className="settings-field-note">{t('form.ambientNote')}</p>
            )}
            {custom && (
              <CustomModels
                discovered={saved?.catalog ?? []}
                models={draft.customModels}
                baseUrl={draft.baseUrl}
                onChange={(customModels) => change({ customModels })}
              />
            )}
          </fieldset>
          {draft.authType === 'oauth' &&
            (saved ? (
              <ProviderSignIn connectionId={saved.connectionId} disabled={disabled} />
            ) : (
              <p className="settings-field-note">{t('form.signInNote')}</p>
            ))}
          {saved?.catalogError && (
            <output className="settings-field-note">{saved.catalogError}</output>
          )}
        </div>
      </ScrollArea>
      <footer ref={footerRef} className="editor-footer overlay-footer">
        {/* The saved connection's catalog actions lead; the edit's own Cancel and Save trail. */}
        {saved && (
          <div className="provider-form-tools">
            <Button
              variant="glass"
              disabled={disabled || !saved.connected}
              onClick={() =>
                void perform('refreshing', async () => {
                  await bridge!.refresh(saved.connectionId);
                  showToast({ kind: 'info', text: t('form.catalogUpdated') });
                })
              }
            >
              {pending === 'refreshing' ? t('form.refreshing') : t('form.refresh')}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* aria-disabled, not disabled: the cost note stays reachable while it is blocked. */}
                <Button
                  variant="glass"
                  aria-disabled={verifyBlocked || undefined}
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  onClick={() => {
                    if (verifyBlocked) return;
                    void perform('verifying', async () => {
                      await bridge!.verify({
                        connectionId: saved.connectionId,
                        modelId: saved.defaultModel,
                      });
                      showToast({ kind: 'info', text: t('form.verified') });
                    });
                  }}
                >
                  {pending === 'verifying' ? t('form.verifying') : t('form.verify')}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-80">
                {t('form.verifyNote')}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
        <div>
          <Button variant="glass" disabled={disabled} onClick={onBack}>
            {t('form.cancel')}
          </Button>
          <Button disabled={disabled || !draft.name.trim()} onClick={() => void save()}>
            {pending === 'saving'
              ? t('form.saving')
              : saved
                ? t('form.saveChanges')
                : t('form.saveConnection')}
          </Button>
        </div>
      </footer>
    </section>
  );
}
