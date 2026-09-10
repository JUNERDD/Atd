import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import type { ProviderSettings } from '../../../electron/settings-contract';
import { useProviderSettings } from './use-provider-settings';

export function ProviderSettingsForm({ provider }: { provider: ProviderSettings | null }) {
  const settings = useProviderSettings(provider);
  const { draft, disabled, pending, hasStoredKey } = settings;
  const keyRemoved = hasStoredKey && draft.apiKey === '';

  return (
    <>
      <header className="settings-section-heading">
        <h2>Providers</h2>
        <p>Connect your AI providers and choose a default model.</p>
      </header>
      <form
        className="settings-provider-form"
        aria-busy={pending !== null}
        onSubmit={(event) => {
          event.preventDefault();
          void settings.saveChanges();
        }}
      >
        <fieldset className="settings-fields" disabled={disabled}>
          <legend className="sr-only">Provider connection</legend>
          <div className="settings-field">
            <Label htmlFor="settings-provider">Provider</Label>
            <Select
              value={draft.id}
              disabled={disabled}
              onValueChange={(value) => {
                if (value === 'openai' || value === 'openai-compatible') {
                  settings.changeProvider(value);
                }
              }}
            >
              <SelectTrigger id="settings-provider" className="settings-input">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="openai-compatible">OpenAI-compatible</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="settings-field">
            <div className="settings-field-label">
              <Label htmlFor="settings-api-key">API key</Label>
              {hasStoredKey && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => settings.changeApiKey(keyRemoved ? undefined : '')}
                >
                  {keyRemoved ? 'Undo removal' : 'Remove key'}
                </Button>
              )}
            </div>
            <Input
              id="settings-api-key"
              className="settings-input"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={draft.apiKey ?? ''}
              placeholder={hasStoredKey ? 'Enter a new API key' : 'Enter an API key'}
              aria-describedby="settings-api-key-note"
              onChange={(event) => settings.changeApiKey(event.target.value)}
            />
            <p id="settings-api-key-note" className="settings-field-note">
              {keyRemoved
                ? 'The saved key will be removed when you save.'
                : hasStoredKey && draft.apiKey === undefined
                  ? settings.endpointChanged
                    ? 'A key is saved for the previous endpoint. Enter a new key or choose Remove key to use this URL.'
                    : 'A key is saved. Leave this field unchanged to keep it.'
                  : 'Your key is stored securely on this device when you save.'}
            </p>
          </div>

          <div className="settings-field">
            <Label htmlFor="settings-base-url">Base URL</Label>
            <Input
              id="settings-base-url"
              className="settings-input"
              type="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={draft.baseUrl}
              readOnly={draft.id === 'openai'}
              required
              placeholder="https://your-provider.example/v1"
              aria-describedby={
                draft.id === 'openai-compatible' ? 'settings-base-url-note' : undefined
              }
              onChange={(event) => settings.changeBaseUrl(event.target.value)}
            />
            {draft.id === 'openai-compatible' && (
              <p id="settings-base-url-note" className="settings-field-note">
                Use an HTTPS endpoint, or HTTP for a local provider.
              </p>
            )}
          </div>

          <div className="settings-field">
            <Label htmlFor="settings-model">Default model</Label>
            <Select
              value={draft.model}
              disabled={disabled || settings.models.length === 0}
              onValueChange={settings.changeModel}
            >
              <SelectTrigger
                id="settings-model"
                className="settings-input"
                aria-describedby="settings-model-note"
              >
                <SelectValue placeholder="Test connection to load models">
                  {draft.model || undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {settings.models.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p id="settings-model-note" className="settings-field-note">
              {settings.models.length > 0
                ? 'Choose from the models returned by your provider.'
                : 'Test the connection to load available models.'}
            </p>
          </div>
        </fieldset>

        {settings.notice && <output className="settings-status">{settings.notice}</output>}
        {(settings.error || settings.status || pending === 'testing') && (
          <p
            className="settings-status"
            data-error={Boolean(settings.error)}
            role={settings.error ? 'alert' : 'status'}
          >
            {settings.error || (pending === 'testing' ? 'Testing connection…' : settings.status)}
          </p>
        )}
        <div className="settings-actions">
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !draft.baseUrl.trim()}
            onClick={() => void settings.testConnection()}
          >
            {pending === 'testing' ? 'Testing…' : 'Test connection'}
          </Button>
          <Button type="submit" disabled={disabled || !settings.dirty}>
            {pending === 'saving' ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </>
  );
}
