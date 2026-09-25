import { useTranslation } from 'react-i18next';
import { Link2Off, Unplug } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@ai/ui/components/empty';
import type { WebHostState } from '.';

/**
 * Shown instead of the panel when the browser cannot use the service yet: it was never paired,
 * the pairing link expired, or the service is down. Pairing links come from the desktop app or
 * `agent-service web`; this page never asks for a secret itself.
 */
export function WebSignIn({ state }: { state: Exclude<WebHostState, { kind: 'ready' }> }) {
  const { t } = useTranslation('panel');
  const offline = state.kind === 'offline';
  return (
    <main className="web-sign-in">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">{offline ? <Unplug /> : <Link2Off />}</EmptyMedia>
          <EmptyTitle>{offline ? t('webSignIn.offlineTitle') : t('webSignIn.title')}</EmptyTitle>
          <EmptyDescription>
            {state.kind === 'offline'
              ? t('webSignIn.offline')
              : state.reason === 'expired'
                ? t('webSignIn.expired')
                : t('webSignIn.none')}
          </EmptyDescription>
        </EmptyHeader>
        {offline && (
          <EmptyContent>
            <Button onClick={() => window.location.reload()}>{t('webSignIn.retry')}</Button>
          </EmptyContent>
        )}
      </Empty>
    </main>
  );
}
