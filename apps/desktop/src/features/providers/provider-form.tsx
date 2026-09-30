import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import type { Connection, ProviderCatalogEntry } from '../../client/providers/schema';
import { CLOUD_FIELDS, isCustom, isAmbient } from '../../client/providers/metadata';
import { showErrorToast, showToast } from '../../components/toast-store';
import { useOverlayFooter } from '../../components/use-overlay-footer';
import { SettingsHeading } from '../settings/settings-heading';
import { sortModels } from './model-order';
import { CustomModels } from './custom-models';
import { ProviderSignIn } from './provider-login';
import { ProviderThinkingLevel } from './provider-thinking-level';
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
  const { draft, change, load, normalize } = useProviderDraft(provider, connection);
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
  const available = [
    ...(saved ? saved.catalog : provider.models),
    ...draft.customModels.filter((model) => model.id.trim()),
  ].filter((model, index, all) => !all.slice(index + 1).some((item) => item.id === model.id));
  const models = sortModels(available);
  const staleModel =
    draft.defaultModel && !models.some((model) => model.id === draft.defaultModel)
      ? draft.defaultModel
      : '';
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
        className="flex-1 min-h-0 min-w-0 m-[-3px_-15px_-3px_-3px]"
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
            <div className="settings-field">
              <Label htmlFor="provider-default-model">{t('form.defaultModel')}</Label>
              <Select
                value={draft.defaultModel}
                onValueChange={(defaultModel) => change({ defaultModel })}
              >
                <SelectTrigger
                  id="provider-default-model"
                  aria-label={t('form.defaultModelLabel', { name: draft.name })}
                >
                  <SelectValue placeholder={t('models.choose')} />
                </SelectTrigger>
                <SelectContent>
                  {staleModel && (
                    <SelectItem value={staleModel}>
                      {t('models.unavailable', { name: staleModel })}
                    </SelectItem>
                  )}
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!available.length && (
                <p className="settings-field-note">
                  {saved ? t('form.catalogNote') : t('form.saveNote')}
                </p>
              )}
            </div>
            <ProviderThinkingLevel
              draft={draft}
              saved={saved}
              disabled={disabled}
              onChange={change}
              onNormalize={normalize}
            />
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
          {saved && (
            <div className="settings-fields">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
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
                <Button
                  variant="outline"
                  disabled={disabled || !saved.connected || !saved.defaultModel}
                  onClick={() =>
                    void perform('verifying', async () => {
                      await bridge!.verify({
                        connectionId: saved.connectionId,
                        modelId: saved.defaultModel,
                      });
                      showToast({ kind: 'info', text: t('form.verified') });
                    })
                  }
                >
                  {pending === 'verifying' ? t('form.verifying') : t('form.verify')}
                </Button>
              </div>
              <p className="settings-field-note">{t('form.verifyNote')}</p>
            </div>
          )}
        </div>
      </ScrollArea>
      <footer ref={footerRef} className="editor-footer overlay-footer">
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
      </footer>
    </section>
  );
}
