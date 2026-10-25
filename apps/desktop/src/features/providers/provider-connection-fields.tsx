import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import { Input } from '@atd/ui/components/input';
import { Label } from '@atd/ui/components/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@atd/ui/components/collapsible';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import type {
  Connection,
  ConnectionDraft,
  ProviderCatalogEntry,
} from '../../client/providers/schema';
import { CLOUD_FIELDS, isCustom, isAmbient } from '../../client/providers/metadata';
import type { ConnectionDraftPatch } from './use-provider-draft';
import { CustomModels } from './custom-models';

/** Authentication and model configuration remain independent of the chosen billing plan. */
export function ProviderConnectionFields({
  provider,
  draft,
  saved,
  disabled,
  change,
}: {
  provider: ProviderCatalogEntry;
  draft: ConnectionDraft;
  saved: Connection | null;
  disabled: boolean;
  change: (patch: ConnectionDraftPatch) => void;
}) {
  const { t } = useTranslation('providers');
  const custom = isCustom(draft.provider);
  const cloud = isAmbient(draft.provider);
  const accountLogin = draft.authType === 'oauth';
  const options =
    provider.auth.length && cloud && !provider.auth.some((auth) => auth.type === 'api_key')
      ? [...provider.auth, { type: 'api_key' as const, label: t('form.authFallback') }]
      : provider.auth;
  return (
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
      {options.length > 1 && (
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
              <SelectGroup>
                {options.map((method) => (
                  <SelectItem key={method.type} value={method.type}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      )}
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
              saved?.hasCredential ? t('form.keepKeyPlaceholder') : t('form.apiKeyPlaceholder')
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
      {!accountLogin && (custom || draft.provider === 'azure' || draft.baseUrl) && (
        <Collapsible defaultOpen={!draft.baseUrl}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="provider-advanced-trigger">
              {t('form.advanced')}
              <ChevronDown />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="settings-field">
              <Label htmlFor="provider-endpoint">
                {draft.provider === 'azure' ? t('form.resourceEndpoint') : t('form.baseUrl')}
              </Label>
              <Input
                id="provider-endpoint"
                type="url"
                value={draft.baseUrl}
                readOnly={!custom && draft.provider !== 'azure'}
                onChange={(event) => change({ baseUrl: event.target.value })}
                placeholder="https://your-provider.example/v1"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
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
  );
}
