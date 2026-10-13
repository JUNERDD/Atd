import { useTranslation } from 'react-i18next';
import { CircleCheck, Info, X } from 'lucide-react';
import { CHATGPT_PRIVACY_VERSION, type ChatGPTConsentRequest } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@atd/ui/components/alert';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@atd/ui/components/dialog';
import type { Connection, ConnectionDraft } from '../../client/providers/schema';
import { showErrorToast } from '../../components/toast-store';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { ManageChatGPTUsage } from './chatgpt-plan';

/** Notice precedes OAuth; background consent is separate, optional and off by default. */
export function ChatGPTSettings({
  draft,
  saved,
  disabled,
  onConsent,
  onResume,
}: {
  draft: ConnectionDraft;
  saved: Connection | null;
  disabled: boolean;
  onConsent: (consent: ChatGPTConsentRequest | undefined) => void;
  onResume: () => void;
}) {
  const { t } = useTranslation('providers');
  if (draft.provider !== 'openai' || draft.authType !== 'oauth') return null;
  const consent = draft.chatgptConsent;
  return (
    <div className="settings-fields">
      <section className="flex min-w-0 flex-col gap-2" aria-labelledby="chatgpt-privacy-title">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 id="chatgpt-privacy-title" className="settings-section-title">
            {t('chatgpt.privacyTitle')}
          </h3>
          <ChatGPTPrivacyDialog />
        </div>
        <Card size="sm" className="settings-card">
          <ItemGroup>
            <SettingsSwitchRow
              id="chatgpt-privacy"
              title={t('chatgpt.privacyAccept')}
              description={t('chatgpt.privacySummary')}
              checked={Boolean(consent)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onConsent(
                  checked
                    ? { privacyVersion: CHATGPT_PRIVACY_VERSION, backgroundAllowed: false }
                    : undefined,
                )
              }
            />
            <SettingsSwitchRow
              id="chatgpt-background"
              title={t('chatgpt.backgroundTitle')}
              description={
                consent ? t('chatgpt.backgroundSummary') : t('chatgpt.backgroundBeforeConsent')
              }
              checked={consent?.backgroundAllowed ?? false}
              disabled={disabled || !consent}
              onCheckedChange={(backgroundAllowed) =>
                onConsent({ privacyVersion: CHATGPT_PRIVACY_VERSION, backgroundAllowed })
              }
            />
          </ItemGroup>
        </Card>
      </section>
      {saved?.connected && !saved.chatgptPlanEnabled && (
        <p className="settings-field-note">{t('chatgpt.planDisabledDescription')}</p>
      )}
      {saved?.chatgptUsagePaused && (
        <Alert role="note" aria-live="polite" aria-atomic="true">
          <AlertDescription>{t('chatgpt.usageLimit')}</AlertDescription>
          <AlertAction className="flex flex-wrap gap-2">
            <ManageChatGPTUsage variant="default" />
            <Button
              variant="outline"
              size="xs"
              disabled={disabled || !consent || Boolean(draft.resumeChatGPTUsage)}
              onClick={onResume}
            >
              {t(draft.resumeChatGPTUsage ? 'chatgpt.resumePending' : 'chatgpt.resume')}
            </Button>
          </AlertAction>
        </Alert>
      )}
    </div>
  );
}

function ChatGPTPrivacyDialog() {
  const { t } = useTranslation('providers');
  const { t: common } = useTranslation('common');
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <Info data-icon="inline-start" aria-hidden />
          {t('chatgpt.privacyDetails')}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="flex max-w-lg flex-col"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{t('chatgpt.privacyTitle')}</DialogTitle>
        </DialogHeader>
        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-4 right-4"
            aria-label={common('close')}
          >
            <X aria-hidden />
          </Button>
        </DialogClose>
        <ScrollArea
          scrollShadow
          viewportProps={{ tabIndex: 0, 'aria-label': t('chatgpt.privacyDetails') }}
        >
          <div className="flex flex-col gap-3 text-sm leading-5">
            <p>{t('chatgpt.privacyIdentity')}</p>
            <p>{t('chatgpt.privacyContent')}</p>
            <p>{t('chatgpt.privacyControl')}</p>
            <p>{t('chatgpt.backgroundDescription')}</p>
          </div>
        </ScrollArea>
        <DialogFooter className="shrink-0 sm:justify-between">
          <Button
            variant="link"
            size="sm"
            className="self-start px-0"
            onClick={() =>
              void window.desktop?.agent
                .openLink('https://openai.com/policies/privacy-policy/')
                .catch(showErrorToast)
            }
          >
            {t('chatgpt.openaiPrivacy')}
          </Button>
          <DialogClose asChild>
            <Button variant="outline">{common('close')}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ChatGPTLoginComplete({ planEnabled }: { planEnabled: boolean }) {
  const { t } = useTranslation('providers');
  return (
    <Alert role="note" aria-live="polite" aria-atomic="true">
      <CircleCheck aria-hidden />
      <AlertTitle>{t(planEnabled ? 'chatgpt.connectedTitle' : 'chatgpt.identityTitle')}</AlertTitle>
      <AlertDescription>
        {t(planEnabled ? 'chatgpt.connectedDescription' : 'chatgpt.planDisabledDescription')}
      </AlertDescription>
    </Alert>
  );
}
