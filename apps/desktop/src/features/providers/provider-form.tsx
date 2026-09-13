import { useEffect, useRef, useState } from 'react';
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
import type {
  Connection,
  ConnectionDraft,
  ProviderCatalogEntry,
} from '../../../electron/providers/schema';
import { CLOUD_FIELDS, isCustom, isAmbient } from '../../../electron/providers/metadata';
import { messageOf } from '../agent/use-agent';
import { SettingsHeading } from '../settings/settings-heading';
import { ModelPicker } from './model-picker';
import { CustomModels } from './custom-models';
import { ProviderSignIn } from './provider-login';
import { draftFrom } from './provider-draft';
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
  const [draft, setDraft] = useState<ConnectionDraft>(() =>
    connection
      ? draftFrom(connection)
      : {
          connectionId: null,
          expectedRevision: null,
          provider: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          authType: provider.auth[0]?.type ?? 'api_key',
          defaultModel: '',
          options: {},
          customModels: [],
        },
  );
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (error) errorMessage.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);
  const bridge = window.desktop?.settings.providers;
  const disabled = Boolean(pending) || !bridge;
  const custom = isCustom(draft.provider);
  const cloud = isAmbient(draft.provider);
  const saved = connection && connection.connectionId === draft.connectionId ? connection : null;
  const options =
    provider.auth.length && cloud && !provider.auth.some((auth) => auth.type === 'api_key')
      ? [...provider.auth, { type: 'api_key' as const, label: 'API key or bearer token' }]
      : provider.auth;
  const available = [
    ...(saved ? saved.catalog : provider.models),
    ...draft.customModels.filter((model) => model.id.trim()),
  ].filter((model, index, all) => !all.slice(index + 1).some((item) => item.id === model.id));
  const preview: Connection = {
    provider: draft.provider,
    name: draft.name,
    baseUrl: draft.baseUrl,
    authType: draft.authType,
    defaultModel: draft.defaultModel,
    options: draft.options,
    customModels: draft.customModels,
    connectionId: draft.connectionId ?? 'draft',
    revision: draft.expectedRevision ?? 1,
    connected: true,
    hasCredential: saved?.hasCredential ?? false,
    catalog: available,
    catalogError: saved?.catalogError ?? '',
    verifiedModel: saved?.verifiedModel ?? '',
  };
  function change(patch: Partial<ConnectionDraft>) {
    setDraft({ ...draft, ...patch });
    setError('');
    setStatus('');
  }
  async function perform(label: string, operation: () => Promise<void>) {
    setPending(label);
    setError('');
    setStatus('');
    try {
      await operation();
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setPending('');
    }
  }
  async function save() {
    if (!bridge) return;
    await perform('saving', async () => {
      const result = await bridge.save(draft);
      setDraft(draftFrom(result));
      onSaved(result);
      setStatus('Connection saved.');
    });
  }
  return (
    <section className="provider-form settings-editor" aria-label="Provider connection">
      <SettingsHeading
        title={saved ? draft.name : `Connect ${provider.name}`}
        onBack={onBack}
        backLabel="Back to providers"
      />
      <ScrollArea className="settings-editor-body">
        <div className="settings-editor-inner settings-fields">
          {saved && saved.revision !== draft.expectedRevision && (
            <output className="settings-field-note">
              Saved settings changed. Your draft is preserved.{' '}
              <Button size="xs" variant="outline" onClick={() => setDraft(draftFrom(saved))}>
                Reload saved settings
              </Button>
            </output>
          )}
          <fieldset disabled={disabled} className="settings-fields">
            <div className="settings-field">
              <Label htmlFor="provider-name">Connection name</Label>
              <Input
                id="provider-name"
                value={draft.name}
                maxLength={120}
                onChange={(event) => change({ name: event.target.value })}
              />
            </div>
            <div className="settings-field">
              <Label htmlFor="provider-auth">Authentication</Label>
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
                  <Label htmlFor="provider-api-key">API key</Label>
                  {saved?.hasCredential && (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => change({ apiKey: draft.apiKey === '' ? undefined : '' })}
                    >
                      {draft.apiKey === '' ? 'Keep saved key' : 'Remove key'}
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
                      ? 'Leave unchanged to keep the saved key'
                      : 'Enter an API key'
                  }
                  onChange={(event) => change({ apiKey: event.target.value })}
                />
                <p className="settings-field-note">
                  {draft.apiKey === '' && saved?.hasCredential
                    ? 'The saved key will be removed when you save.'
                    : 'Credentials are encrypted on this device.'}
                </p>
              </div>
            )}
            {(custom || draft.provider === 'azure-openai-responses' || draft.baseUrl) && (
              <div className="settings-field">
                <Label htmlFor="provider-endpoint">
                  {draft.provider === 'azure-openai-responses' ? 'Resource endpoint' : 'Base URL'}
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
              <p className="settings-field-note">
                Use the configured AWS credentials or Google Application Default Credentials on this
                device. Save this connection to opt in.
              </p>
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
              <Label>Default model</Label>
              <ModelPicker
                scoped
                connections={[preview]}
                value={
                  draft.defaultModel
                    ? { connectionId: preview.connectionId, modelId: draft.defaultModel }
                    : null
                }
                label={`Default model for ${draft.name}`}
                onChange={(model) => change({ defaultModel: model.modelId })}
                disabled={disabled}
              />
              {!available.length && (
                <p className="settings-field-note">
                  Save the connection, then refresh models or add a custom model.
                </p>
              )}
            </div>
          </fieldset>
          {draft.authType === 'oauth' &&
            (saved ? (
              <ProviderSignIn connectionId={saved.connectionId} disabled={disabled} />
            ) : (
              <p className="settings-field-note">Save this connection to start account sign-in.</p>
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
                      setStatus('Model catalog updated.');
                    })
                  }
                >
                  {pending === 'refreshing' ? 'Refreshing…' : 'Refresh models'}
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
                      setStatus('Model access verified.');
                    })
                  }
                >
                  {pending === 'verifying' ? 'Verifying…' : 'Verify model access'}
                </Button>
              </div>
              <p className="settings-field-note">
                Verification sends a small model request and may use credits. It does not run tools.
              </p>
            </div>
          )}
          {error && (
            <p ref={errorMessage} role="alert" className="settings-status" data-error="true">
              {error}
            </p>
          )}
          {status && <output className="settings-field-note">{status}</output>}
        </div>
      </ScrollArea>
      <footer className="editor-footer">
        <Button variant="outline" disabled={disabled} onClick={onBack}>
          Cancel
        </Button>
        <Button disabled={disabled || !draft.name.trim()} onClick={() => void save()}>
          {pending === 'saving' ? 'Saving…' : saved ? 'Save changes' : 'Save connection'}
        </Button>
      </footer>
    </section>
  );
}
