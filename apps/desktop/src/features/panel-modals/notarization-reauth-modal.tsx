import { useEffect, useState, type ReactNode } from 'react';
import { Check, CircleAlert, KeyRound, ShieldCheck, ShieldEllipsis } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { morphIn } from '../onboarding/step-motion';
import { useServiceStatus } from '../service/use-service';
import { NotarizationArt } from './notarization-art';
import { PanelModalSlide } from './panel-modal';

interface ReauthRowItemProps {
  resolved: boolean;
  pendingIcon?: ReactNode;
  resolvedIcon?: ReactNode;
  title: string;
  description: string;
  resolvedDescription: string;
  resolvedBadge: string;
  actionLabel: string;
  errorMessage: string;
  onAction: () => Promise<void>;
}

/** Single status/action row inside the notarization re-authorization modal. */
function ReauthRowItem({
  resolved,
  pendingIcon,
  resolvedIcon,
  title,
  description,
  resolvedDescription,
  resolvedBadge,
  actionLabel,
  errorMessage,
  onAction,
}: ReauthRowItemProps) {
  const reduced = useReducedMotion() ?? false;
  const [failed, setFailed] = useState(false);

  async function handleAction() {
    setFailed(false);
    try {
      await onAction();
    } catch {
      setFailed(true);
    }
  }

  return (
    <Item asChild size="sm" className="panel-modal-perm-row">
      <li>
        <ItemMedia
          variant="icon"
          className="panel-modal-perm-icon"
          data-granted={resolved || undefined}
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span key={resolved ? 'resolved' : 'pending'} {...morphIn(reduced)}>
              {resolved
                ? (resolvedIcon ?? <ShieldCheck aria-hidden="true" />)
                : (pendingIcon ?? <ShieldEllipsis aria-hidden="true" />)}
            </motion.span>
          </AnimatePresence>
        </ItemMedia>
        <ItemContent className="min-w-0 flex-1">
          <ItemTitle className="whitespace-normal">{title}</ItemTitle>
          <ItemDescription className="whitespace-normal">
            {resolved ? resolvedDescription : description}
          </ItemDescription>
        </ItemContent>
        {resolved ? (
          <span className="panel-modal-perm-granted">
            <Check aria-hidden="true" />
            <span>{resolvedBadge}</span>
          </span>
        ) : (
          <ItemActions className="ml-auto">
            <Button type="button" variant="outline" size="sm" onClick={() => void handleAction()}>
              {actionLabel}
            </Button>
          </ItemActions>
        )}
        {failed && !resolved && (
          <ItemFooter role="alert" className="panel-modal-perm-error">
            <CircleAlert aria-hidden="true" />
            <span>{errorMessage}</span>
          </ItemFooter>
        )}
      </li>
    </Item>
  );
}

/**
 * Main-panel slide informing macOS users that Atd switched notarization certificates and letting
 * them launch System Settings PermissionGuide or jump directly to Model Settings.
 */
export function NotarizationReauthModal({
  snapshot,
  onDismiss,
  onComplete,
}: {
  snapshot: SettingsSnapshot;
  onDismiss: () => void;
  onComplete: () => void;
}) {
  const { t } = useTranslation('panel');
  const [primaryFailed, setPrimaryFailed] = useState(false);
  const { status } = useServiceStatus();
  const serviceConnected = status?.state === 'connected';

  const showAccessibility = snapshot.accessibilityTrusted !== null;
  const showScreenRecording = snapshot.screenRecordingTrusted !== null;
  const needsAccessibility = snapshot.accessibilityTrusted === false;
  const needsScreenRecording = snapshot.screenRecordingTrusted === false;
  const permissionsGranted =
    (showAccessibility || showScreenRecording) && !needsAccessibility && !needsScreenRecording;

  const credentialIssueCount = snapshot.connections.filter(
    (connection) => connection.credentialIssue != null,
  ).length;
  const [hadCredentialIssue, setHadCredentialIssue] = useState(credentialIssueCount > 0);
  const hasCredentialIssues = credentialIssueCount > 0;
  if (hasCredentialIssues && !hadCredentialIssue) {
    setHadCredentialIssue(true);
  }
  const credentialsRestored = !hasCredentialIssues && hadCredentialIssue;
  const allResolved = permissionsGranted && !hasCredentialIssues;

  useEffect(() => {
    if (!serviceConnected) return;
    const probe = () => {
      if (document.visibilityState === 'hidden') return;
      void window.desktop?.settings.providers.checkStatuses().catch(() => {});
    };
    probe();
    window.addEventListener('focus', probe);
    document.addEventListener('visibilitychange', probe);
    return () => {
      window.removeEventListener('focus', probe);
      document.removeEventListener('visibilitychange', probe);
    };
  }, [serviceConnected]);

  async function requestAccessibility() {
    const settings = window.desktop?.settings;
    if (!settings) throw new Error('Settings bridge unavailable');
    await settings.requestAccessibility();
  }

  async function requestScreenRecording() {
    const settings = window.desktop?.settings;
    if (!settings) throw new Error('Settings bridge unavailable');
    await settings.requestScreenRecording();
  }

  async function openCredentialsSettings() {
    const settings = window.desktop?.settings;
    if (!settings) throw new Error('Settings bridge unavailable');
    await settings.openSection('providers');
  }

  const primaryLabel =
    permissionsGranted && hasCredentialIssues
      ? t('modals.notarizationReauth.credentials.openPrimary')
      : !needsAccessibility && needsScreenRecording
        ? t('modals.notarizationReauth.authorizeScreenRecording')
        : needsAccessibility && !needsScreenRecording
          ? t('modals.notarizationReauth.authorizeAccessibility')
          : t('modals.notarizationReauth.authorize');

  async function handlePrimaryAuthorize() {
    setPrimaryFailed(false);
    try {
      if (needsAccessibility) {
        await requestAccessibility();
      } else if (needsScreenRecording) {
        await requestScreenRecording();
      } else if (hasCredentialIssues) {
        await openCredentialsSettings();
      }
    } catch {
      setPrimaryFailed(true);
    }
  }

  const credentialDescription = hasCredentialIssues
    ? t('modals.notarizationReauth.credentials.issueDescription', {
        count: credentialIssueCount,
      })
    : t('modals.notarizationReauth.credentials.description');

  return (
    <PanelModalSlide
      title={t('modals.notarizationReauth.title')}
      description={t('modals.notarizationReauth.description')}
      media={<NotarizationArt />}
      footer={
        allResolved ? (
          <Button type="button" variant="default" onClick={onComplete}>
            {t('modals.notarizationReauth.done')}
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={onDismiss}>
              {t('modals.notarizationReauth.later')}
            </Button>
            <Button type="button" variant="default" onClick={() => void handlePrimaryAuthorize()}>
              {primaryLabel}
            </Button>
          </>
        )
      }
    >
      <Card size="sm" className="panel-modal-group">
        <ItemGroup>
          {showAccessibility && (
            <ReauthRowItem
              resolved={!needsAccessibility}
              title={t('modals.notarizationReauth.accessibility.title')}
              description={t('modals.notarizationReauth.accessibility.description')}
              resolvedDescription={t('modals.notarizationReauth.accessibility.grantedDescription')}
              resolvedBadge={t('modals.notarizationReauth.grantedBadge')}
              actionLabel={t('modals.notarizationReauth.openRow')}
              errorMessage={t('modals.notarizationReauth.error')}
              onAction={requestAccessibility}
            />
          )}
          {showScreenRecording && (
            <ReauthRowItem
              resolved={!needsScreenRecording}
              title={t('modals.notarizationReauth.screenRecording.title')}
              description={t('modals.notarizationReauth.screenRecording.description')}
              resolvedDescription={t(
                'modals.notarizationReauth.screenRecording.grantedDescription',
              )}
              resolvedBadge={t('modals.notarizationReauth.grantedBadge')}
              actionLabel={t('modals.notarizationReauth.openRow')}
              errorMessage={t('modals.notarizationReauth.error')}
              onAction={requestScreenRecording}
            />
          )}
          <ReauthRowItem
            resolved={credentialsRestored}
            pendingIcon={<KeyRound aria-hidden="true" />}
            resolvedIcon={<KeyRound aria-hidden="true" />}
            title={t('modals.notarizationReauth.credentials.title')}
            description={credentialDescription}
            resolvedDescription={t('modals.notarizationReauth.credentials.restoredDescription')}
            resolvedBadge={t('modals.notarizationReauth.credentials.restoredBadge')}
            actionLabel={t('modals.notarizationReauth.credentials.openAction')}
            errorMessage={t('modals.notarizationReauth.credentials.error')}
            onAction={openCredentialsSettings}
          />
        </ItemGroup>
      </Card>
      {primaryFailed && !allResolved && (
        <p role="alert" className="panel-modal-perm-error">
          <CircleAlert aria-hidden="true" />
          <span>
            {permissionsGranted && hasCredentialIssues
              ? t('modals.notarizationReauth.credentials.error')
              : t('modals.notarizationReauth.error')}
          </span>
        </p>
      )}
    </PanelModalSlide>
  );
}
