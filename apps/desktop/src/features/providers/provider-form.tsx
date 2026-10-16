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
  SelectGroup,
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
import { useProviderLogin } from './use-provider-login';
import { ChatGPTPlan, ChatGPTWelcome } from './chatgpt-plan';
import { ProviderBrand } from './provider-brand';
import { ChatGPTSettings } from './chatgpt-settings';
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
  const { draft, dirty, change, load } = useProviderDraft(provider, connection);
  const login = useProviderLogin();
  const [pending, setPending] = useState('');
  const footerRef = useOverlayFooter<HTMLElement>();
  const bridge = window.desktop?.settings.providers;
  const disabled = Boolean(pending) || login.waiting || !bridge;
  const custom = isCustom(draft.provider);
  const cloud = isAmbient(draft.provider);
  const saved = connection && connection.connectionId === draft.connectionId ? connection : null;
  const accountLogin = draft.authType === 'oauth';
  const needsSignIn = accountLogin && !saved?.connected;
  const chatgpt = accountLogin && draft.provider === 'openai';
  const noticeMissing = chatgpt && !draft.chatgptConsent;
  const planDisabled = chatgpt && saved?.connected && !saved.chatgptPlanEnabled;
  const options =
    provider.auth.length && cloud && !provider.auth.some((auth) => auth.type === 'api_key')
      ? [...provider.auth, { type: 'api_key' as const, label: t('form.authFallback') }]
      : provider.auth;
  const refreshBlocked = disabled || dirty || !saved?.connected || planDisabled || noticeMissing;
  const verifyBlocked = refreshBlocked || !saved?.defaultModel;
  async function perform(label: string, operation: () => Promise<void>) {
    setPending(label);
    try {
      await operation();
    } catch (error) {
      showErrorToast(error);
    }
    setPending('');
  }
  async function save(forceSignIn = false) {
    if (!bridge) return;
    const signingIn = needsSignIn || forceSignIn;
    await perform(signingIn ? 'signingIn' : 'saving', async () => {
      const result = dirty || !saved ? await bridge.save(draft) : saved;
      load(draftFrom(result));
      // Leaves through `replace`, which never asks about unsaved changes.
      onSaved(result);
      if (signingIn) await login.start(result.connectionId, Boolean(planDisabled));
      else showToast({ kind: 'info', text: t('form.saved') });
    });
  }
  return (
    <section className="provider-form settings-editor" aria-label={t('form.sectionLabel')}>
      <SettingsHeading
        title={
          saved
            ? draft.name
            : t(accountLogin ? 'form.signIn' : 'form.connect', { name: provider.name })
        }
        subpage
        backLabel={t('form.back')}
      />
      <ScrollArea
        className="settings-page-scroll"
        viewportClassName="overlay-footer-fade"
        gutter="none"
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
          {saved?.authNotice && <output className="settings-field-note">{saved.authNotice}</output>}
          <ChatGPTPlan connection={saved} showAccount />
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
            {!accountLogin && (custom || draft.provider === 'azure' || draft.baseUrl) && (
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
          {accountLogin && (
            <>
              {!login.state && needsSignIn && (
                <p className="settings-field-note">{t('form.signInNote')}</p>
              )}
              <ProviderSignIn state={login.state} disabled={Boolean(pending) || !bridge} />
              {saved?.connected && !login.waiting && (
                <Button
                  variant="outline"
                  disabled={disabled || noticeMissing}
                  onClick={() => void save(true)}
                >
                  {draft.provider === 'openai' && <ProviderBrand provider="openai" />}
                  {t(
                    planDisabled
                      ? 'chatgpt.enablePlan'
                      : chatgpt
                        ? 'chatgpt.continue'
                        : 'login.signInAgain',
                  )}
                </Button>
              )}
            </>
          )}
          <ChatGPTSettings
            draft={draft}
            saved={saved}
            disabled={disabled}
            onConsent={(chatgptConsent) => change({ chatgptConsent })}
            onResume={() => change({ resumeChatGPTUsage: true })}
          />
          {saved?.catalogError && (
            <output className="settings-field-note">{saved.catalogError}</output>
          )}
        </div>
      </ScrollArea>
      <footer ref={footerRef} className="editor-footer overlay-footer">
        {/* The saved connection's catalog actions lead; the edit's own Cancel and Save trail. */}
        {saved && (
          <div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="glass"
                  aria-disabled={refreshBlocked || undefined}
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  onClick={() => {
                    if (refreshBlocked) return;
                    void perform('refreshing', async () => {
                      await bridge!.refresh(saved.connectionId);
                      showToast({ kind: 'info', text: t('form.catalogUpdated') });
                    });
                  }}
                >
                  {pending === 'refreshing' ? t('form.refreshing') : t('form.refresh')}
                </Button>
              </TooltipTrigger>
              {dirty && (
                <TooltipContent side="top" className="max-w-80">
                  {t('form.saveBeforeRefresh')}
                </TooltipContent>
              )}
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* aria-disabled keeps the action's explanation reachable while it is blocked. */}
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
                {t(dirty ? 'form.saveBeforeVerify' : 'form.verifyNote')}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
        <div>
          <Button
            variant="glass"
            disabled={Boolean(pending)}
            onClick={() => {
              if (login.waiting) void perform('cancelling', login.cancel);
              else onBack();
            }}
          >
            {login.waiting ? t('login.cancel') : t('form.cancel')}
          </Button>
          <Button
            disabled={disabled || noticeMissing || !draft.name.trim()}
            onClick={() => void save()}
          >
            {needsSignIn && draft.provider === 'openai' && <ProviderBrand provider="openai" />}
            {login.waiting || pending === 'signingIn'
              ? t('login.signingIn')
              : pending === 'saving'
                ? t('form.saving')
                : needsSignIn
                  ? t(draft.provider === 'openai' ? 'chatgpt.continue' : 'login.signIn')
                  : saved
                    ? t('form.saveChanges')
                    : t('form.saveConnection')}
          </Button>
        </div>
      </footer>
      {draft.provider === 'openai' && accountLogin && (
        <ChatGPTWelcome
          complete={login.state?.status === 'complete' && login.state.chatgptPlanEnabled === true}
        />
      )}
    </section>
  );
}
