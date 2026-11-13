import { useState } from 'react';
import { Check, CircleAlert, ShieldCheck, ShieldEllipsis } from 'lucide-react';
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
import { NotarizationArt } from './notarization-art';
import { PanelModalSlide } from './panel-modal';

interface ReauthPermissionItemProps {
  trusted: boolean;
  title: string;
  description: string;
  grantedDescription: string;
  grantedBadge: string;
  openLabel: string;
  errorMessage: string;
  onRequest: () => Promise<void>;
}

function ReauthPermissionItem({
  trusted,
  title,
  description,
  grantedDescription,
  grantedBadge,
  openLabel,
  errorMessage,
  onRequest,
}: ReauthPermissionItemProps) {
  const reduced = useReducedMotion() ?? false;
  const [failed, setFailed] = useState(false);

  async function handleOpen() {
    setFailed(false);
    try {
      await onRequest();
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
          data-granted={trusted || undefined}
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span key={trusted ? 'granted' : 'needed'} {...morphIn(reduced)}>
              {trusted ? <ShieldCheck aria-hidden="true" /> : <ShieldEllipsis aria-hidden="true" />}
            </motion.span>
          </AnimatePresence>
        </ItemMedia>
        <ItemContent className="min-w-0 flex-1">
          <ItemTitle className="whitespace-normal">{title}</ItemTitle>
          <ItemDescription className="whitespace-normal">
            {trusted ? grantedDescription : description}
          </ItemDescription>
        </ItemContent>
        {trusted ? (
          <span className="panel-modal-perm-granted">
            <Check aria-hidden="true" />
            <span>{grantedBadge}</span>
          </span>
        ) : (
          <ItemActions className="ml-auto">
            <Button type="button" variant="outline" size="sm" onClick={() => void handleOpen()}>
              {openLabel}
            </Button>
          </ItemActions>
        )}
        {failed && !trusted && (
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
 * them launch the docked draggable System Settings PermissionGuide in one click.
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

  const showAccessibility = snapshot.accessibilityTrusted !== null;
  const showScreenRecording = snapshot.screenRecordingTrusted !== null;
  const needsAccessibility = snapshot.accessibilityTrusted === false;
  const needsScreenRecording = snapshot.screenRecordingTrusted === false;
  const allGranted =
    (showAccessibility || showScreenRecording) && !needsAccessibility && !needsScreenRecording;

  const primaryLabel =
    !needsAccessibility && needsScreenRecording
      ? t('modals.notarizationReauth.authorizeScreenRecording')
      : needsAccessibility && !needsScreenRecording
        ? t('modals.notarizationReauth.authorizeAccessibility')
        : t('modals.notarizationReauth.authorize');

  async function handlePrimaryAuthorize() {
    setPrimaryFailed(false);
    try {
      if (needsAccessibility) {
        await window.desktop?.settings.requestAccessibility();
      } else if (needsScreenRecording) {
        await window.desktop?.settings.requestScreenRecording();
      }
    } catch {
      setPrimaryFailed(true);
    }
  }

  return (
    <PanelModalSlide
      title={t('modals.notarizationReauth.title')}
      description={t('modals.notarizationReauth.description')}
      media={<NotarizationArt />}
      footer={
        allGranted ? (
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
            <ReauthPermissionItem
              trusted={!needsAccessibility}
              title={t('modals.notarizationReauth.accessibility.title')}
              description={t('modals.notarizationReauth.accessibility.description')}
              grantedDescription={t('modals.notarizationReauth.accessibility.grantedDescription')}
              grantedBadge={t('modals.notarizationReauth.grantedBadge')}
              openLabel={t('modals.notarizationReauth.openRow')}
              errorMessage={t('modals.notarizationReauth.error')}
              onRequest={async () => {
                await window.desktop?.settings.requestAccessibility();
              }}
            />
          )}
          {showScreenRecording && (
            <ReauthPermissionItem
              trusted={!needsScreenRecording}
              title={t('modals.notarizationReauth.screenRecording.title')}
              description={t('modals.notarizationReauth.screenRecording.description')}
              grantedDescription={t('modals.notarizationReauth.screenRecording.grantedDescription')}
              grantedBadge={t('modals.notarizationReauth.grantedBadge')}
              openLabel={t('modals.notarizationReauth.openRow')}
              errorMessage={t('modals.notarizationReauth.error')}
              onRequest={async () => {
                await window.desktop?.settings.requestScreenRecording();
              }}
            />
          )}
        </ItemGroup>
      </Card>
      {primaryFailed && !allGranted && (
        <p role="alert" className="panel-modal-perm-error">
          <CircleAlert aria-hidden="true" />
          <span>{t('modals.notarizationReauth.error')}</span>
        </p>
      )}
    </PanelModalSlide>
  );
}
