import { KeyRound, Plug, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { showErrorToast } from '../../components/toast-store';
import { GoalStatus, OnboardingStep } from './onboarding-step';
import type { StepRenderProps } from './onboarding-types';
import { readyConnection, unreadableConnection } from './use-onboarding-goals';

/** Settings › Providers, opened on top of the guide. */
function openProviders() {
  void window.desktop?.settings.openSection('providers').catch(showErrorToast);
}

/**
 * Step 5: an AI provider. Connecting happens in Settings › Providers, which opens on top; the
 * step follows the settings broadcasts, and its goal is met once the default alias or connection
 * is connected with readable credentials and a model, named in the status.
 */
export function ProviderStep({ snapshot, focusHeading }: StepRenderProps) {
  const { t } = useTranslation('onboarding');
  const ready = readyConnection(snapshot);
  const unreadable = ready ? null : unreadableConnection(snapshot);
  return (
    <OnboardingStep
      title={t('provider.title')}
      description={t('provider.description')}
      status={
        <GoalStatus
          met={ready !== null}
          waiting={
            unreadable ? t('provider.unreadable', { name: unreadable.name }) : t('provider.waiting')
          }
          success={ready ? t('provider.connected', { name: ready.connection.name }) : ''}
          detail={
            ready
              ? ready.aliasName
                ? t('provider.modelWithAlias', { alias: ready.aliasName, model: ready.model })
                : t('provider.model', { model: ready.model })
              : undefined
          }
        />
      }
      focusHeading={focusHeading}
    >
      <div className="guide-group">
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={!window.desktop}
          onClick={openProviders}
        >
          {unreadable ? (
            <KeyRound data-icon="inline-start" />
          ) : ready ? (
            <Settings2 data-icon="inline-start" />
          ) : (
            <Plug data-icon="inline-start" />
          )}
          {unreadable
            ? t('provider.reconnect')
            : ready
              ? t('provider.manage')
              : t('provider.connect')}
        </Button>
        <p className="settings-field-note">{t('provider.footnote')}</p>
      </div>
    </OnboardingStep>
  );
}
