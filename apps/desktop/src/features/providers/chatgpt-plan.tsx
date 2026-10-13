import { useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { cn } from '@atd/ui/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@atd/ui/components/dialog';
import type { Connection } from '../../client/providers/schema';
import { showErrorToast } from '../../components/toast-store';
import { chatgptUsageError, type ChatGPTUsageError as UsageError } from '@atd/agent-contracts';

const WELCOME_KEY = 'atd.chatgpt-plan-welcome';

export function ManageChatGPTUsage({
  variant = 'outline',
  className,
}: Pick<ComponentProps<typeof Button>, 'variant' | 'className'>) {
  const { t } = useTranslation('providers');
  return (
    <Button
      variant={variant}
      size="xs"
      className={className}
      onClick={() => {
        void window.desktop?.agent
          .openLink('https://chatgpt.com/settings/usage')
          .catch(showErrorToast);
      }}
    >
      {t('chatgpt.manageUsage')}
    </Button>
  );
}

/** Shared with the model picker, so the current billing source remains visible. */
export function ChatGPTPlan({
  connection,
  showAccount = false,
  variant = 'inline',
}: {
  connection: Connection | null | undefined;
  showAccount?: boolean;
  variant?: 'inline' | 'menu';
}) {
  const { t } = useTranslation('providers');
  if (!connection?.connected || connection.provider !== 'openai' || connection.authType !== 'oauth')
    return null;
  return (
    <div
      className={cn(
        'flex items-center gap-2 text-xs text-muted-foreground',
        variant === 'menu' ? 'justify-between px-2 py-1' : 'flex-wrap',
      )}
    >
      <span className={variant === 'menu' ? 'min-w-0 flex-1' : undefined}>
        {t(
          connection.chatgptUsagePaused
            ? 'chatgpt.paused'
            : connection.chatgptPlanEnabled
              ? 'chatgpt.usingPlan'
              : 'chatgpt.planDisabled',
        )}
      </span>
      {showAccount && connection.accountLabel && (
        <span className="wrap-anywhere">{connection.accountLabel}</span>
      )}
      <ManageChatGPTUsage
        variant={variant === 'menu' ? 'link' : 'outline'}
        className={variant === 'menu' ? 'px-0 focus-visible:ring-inset' : undefined}
      />
    </div>
  );
}

export function ChatGPTWelcome({ complete }: { complete: boolean }) {
  const { t } = useTranslation('providers');
  const [seen, setSeen] = useState(() => window.localStorage.getItem(WELCOME_KEY) === '1');
  function dismiss() {
    window.localStorage.setItem(WELCOME_KEY, '1');
    setSeen(true);
  }
  return (
    <Dialog
      open={complete && !seen}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('chatgpt.welcomeTitle')}</DialogTitle>
          <DialogDescription>{t('chatgpt.welcomeDescription')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={dismiss}>{t('chatgpt.gotIt')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ChatGPTUsageError({ error }: { error: string }) {
  const { t } = useTranslation('providers');
  const code = chatgptUsageError(error);
  if (!code) return null;
  const messages = {
    subscription_sharing_usage_limit_exceeded: 'chatgpt.usageLimit',
    subscription_sharing_usage_unavailable: 'chatgpt.usageUnavailable',
    subscription_sharing_user_not_eligible: 'chatgpt.notEligible',
    subscription_sharing_user_unavailable: 'chatgpt.userUnavailable',
    subscription_sharing_unsupported_capability: 'chatgpt.unsupportedCapability',
    subscription_sharing_route_not_supported: 'chatgpt.unsupportedRoute',
    subscription_sharing_invalid_user: 'chatgpt.invalidUser',
    chatpass_v2_scope_not_authorized: 'chatgpt.planDisabledDescription',
    chatpass_v2_invalid_authorization_context: 'chatgpt.authorizationInvalid',
    chatgpt_plan_disabled: 'chatgpt.planDisabledDescription',
    chatgpt_privacy_required: 'chatgpt.privacyRequired',
    chatgpt_background_consent_required: 'chatgpt.backgroundRequired',
  } as const satisfies Record<UsageError, string>;
  const limit = code === 'subscription_sharing_usage_limit_exceeded';
  return (
    <div className="flex flex-col items-start gap-2">
      <p>{t(messages[code])}</p>
      <div className="flex flex-wrap gap-2">
        {limit && <ManageChatGPTUsage variant="default" />}
        <Button
          size="xs"
          variant="outline"
          onClick={() => void window.desktop?.settings.open().catch(showErrorToast)}
        >
          {t('chatgpt.openSettings')}
        </Button>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer">{t('chatgpt.errorDetails')}</summary>
        <p className="mt-2 wrap-anywhere whitespace-pre-wrap">{error}</p>
      </details>
    </div>
  );
}
