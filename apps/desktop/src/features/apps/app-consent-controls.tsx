import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppCapabilityConsent } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { isTextEntryFocused } from '../../lib/text-entry';
import { ShortcutHint } from '../agent/transcript/approval-controls';
import { AppIcon } from './app-icon';
import { CAPABILITY_ICONS } from './capability-icons';
import { useAppActions } from './use-app-actions';
import { useApps } from './use-apps';
import './apps.css';

/**
 * One app capability consent in the composer's HITL view (Figma `App / App capability consent`):
 * the app's icon, what it asks for and what that capability does, the purpose the app declared,
 * and that Atd remembers the answer. Allow (Return) and Deny (Escape) store the answer for the
 * app (`PATCH /v1/apps/:id/grants`), which settles every request waiting on that capability.
 * There is no allow-once: Settings › Apps changes the answer later.
 */
export function AppConsentControls({
  consent,
  focusOnMount,
}: {
  consent: AppCapabilityConsent;
  /** Focus Allow on mount; the popover's pager turns it off after paging. */
  focusOnMount: boolean;
}) {
  const { t } = useTranslation('apps');
  const actions = useAppActions();
  const { apps } = useApps();
  const allowRef = useRef<HTMLButtonElement>(null);
  const version = apps?.find(({ id }) => id === consent.appId)?.currentVersion ?? 1;
  const busy = actions.busy.has(consent.appId);
  const Icon = CAPABILITY_ICONS[consent.capability];

  useEffect(() => {
    // Like a tool approval, an arrival takes focus only while the user is not typing.
    if (!focusOnMount || isTextEntryFocused()) return;
    allowRef.current?.focus();
  }, [consent.id, focusOnMount]);

  function answer(state: 'granted' | 'denied') {
    if (!busy) void actions.setGrant(consent.appId, consent.capability, state);
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'Escape') return;
    // Deny, not dismiss: the popover's own Escape would only close the view.
    event.preventDefault();
    event.stopPropagation();
    answer('denied');
  }

  return (
    <div className="approval-controls">
      <div className="flex min-w-0 items-start gap-2.5">
        <AppIcon appId={consent.appId} version={version} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <Icon aria-hidden className="size-4 shrink-0" />
            <span className="min-w-0 wrap-anywhere">
              {t('consent.title', {
                app: consent.appName,
                capability: t(`capability.${consent.capability}.action`),
              })}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {t(`capability.${consent.capability}.consent`)}
          </p>
        </div>
      </div>
      {consent.purpose && (
        <div className="app-consent-purpose">
          <span className="text-muted-foreground">{t('consent.purpose')}</span>
          <span className="wrap-anywhere">{consent.purpose}</span>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('consent.remembered')}</p>
      <div className="approval-actions justify-end">
        <Button
          ref={allowRef}
          variant="outline"
          aria-disabled={busy || undefined}
          onClick={() => answer('granted')}
          onKeyDown={onKeyDown}
        >
          {t('consent.allow')}
          <ShortcutHint accelerator="Enter" />
        </Button>
        <Button
          variant="outline"
          aria-disabled={busy || undefined}
          onClick={() => answer('denied')}
          onKeyDown={onKeyDown}
        >
          {t('consent.deny')}
          <ShortcutHint accelerator="Escape" />
        </Button>
      </div>
    </div>
  );
}
