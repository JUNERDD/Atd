import { useCallback, useContext, useId, useState } from 'react';
import { CircleAlert, Download, RefreshCw, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LiveProbeKind } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import { Label } from '@atd/ui/components/label';
import { Switch } from '@atd/ui/components/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';
import {
  ItemsPlaceholder,
  LoadingPlaceholder,
  TextPlaceholder,
} from '../../components/loading-placeholder';
import { BarAction } from '../../components/bar-action';
import { useCompacted, useOneLineActions } from '../../components/one-line-actions';
import { showErrorToast, showToast } from '../../components/toast-store';
import { SettingsHeading } from '../settings/settings-heading';
import { SettingsNavigationContext } from '../settings/settings-navigation';
import { LAYER_KEYS } from './diagnostics-labels';
import { DOCTOR_LAYERS, useDiagnosticsDoctor } from './diagnostics-model';
import { DoctorCheckRow } from './doctor-check-row';
import { LiveProbePanel } from './live-probe-panel';
import { PrivacyPreviewDialog } from './privacy-preview-dialog';

const RING_TITLE_KEYS = {
  selection: 'rings.selection',
  hotkeys: 'rings.hotkeys',
  capture_arbiter: 'rings.capture_arbiter',
  relay_supervisor: 'rings.relay_supervisor',
} as const;

/**
 * The checks list while a run has nothing to show yet: the summary line over one titled group of
 * outlined rows per layer, in the list's own gaps and row size. It holds the list's place, so the
 * results replace it where they will appear instead of pushing Live probes down when they land.
 */
function DoctorChecksPlaceholder({ label }: { label: string }) {
  return (
    <LoadingPlaceholder label={label} className="gap-5">
      <TextPlaceholder size="xs" width="half" />
      {DOCTOR_LAYERS.map((layer) => (
        <div key={layer} className="flex flex-col gap-2">
          <TextPlaceholder width="quarter" />
          <ItemsPlaceholder count={3} size="sm" variant="outline" trailing="none" />
        </div>
      ))}
    </LoadingPlaceholder>
  );
}

export function DiagnosticsSettings() {
  const { t } = useTranslation('diagnostics');
  const navigate = useContext(SettingsNavigationContext);
  const toolbarRef = useOneLineActions<HTMLDivElement>();
  const [includeConnectivity, setIncludeConnectivity] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [requestedProbe, setRequestedProbe] = useState<LiveProbeKind | null>(null);

  const {
    running,
    shellReport,
    serviceReport,
    serviceError,
    shellError,
    layers,
    counts,
    runChecks,
  } = useDiagnosticsDoctor(includeConnectivity);

  const canRestartService = shellReport !== null && !shellReport.isDevelopment;
  const showRestart =
    canRestartService && (shellReport?.serviceState === 'unavailable' || Boolean(serviceError));

  const handleRestartService = useCallback(async () => {
    const bridge = window.desktop?.diagnostics;
    if (!bridge || restarting) return;
    setRestarting(true);
    try {
      const result = await bridge.restartService();
      if (result.ok) {
        showToast({ kind: 'info', text: t('actions.serviceRestarted') });
        void runChecks();
      } else {
        showErrorToast(result.summary);
      }
    } catch (error) {
      showErrorToast(error);
    } finally {
      setRestarting(false);
    }
  }, [restarting, runChecks, t]);

  const handleOpenSettingsSection = useCallback(
    (section: string) => {
      if (navigate) navigate(section);
      else void window.desktop?.settings?.openSection(section).catch(showErrorToast);
    },
    [navigate],
  );

  const handleOpenExternalDocs = useCallback((url: string) => {
    void window.desktop?.agent?.openLink(url).catch(showErrorToast);
  }, []);

  const handleProbeHandled = useCallback(() => setRequestedProbe(null), []);

  const offlineSummary = shellReport?.serviceFailureSummary ?? serviceError;

  return (
    <section className="flex flex-col gap-6" aria-label={t('overview.title')}>
      <SettingsHeading title={t('overview.title')} description={t('overview.description')} />

      {/* One line: short of room, Export, Restart, then the connectivity option give up labels. */}
      <div
        ref={toolbarRef}
        className="flex items-center gap-2"
        data-settings-anchor="diagnostics-doctor"
      >
        <Button type="button" disabled={running} onClick={() => void runChecks()}>
          <RefreshCw
            data-icon="inline-start"
            aria-hidden="true"
            className={running ? 'animate-spin' : undefined}
          />
          {running ? t('actions.runningChecks') : t('actions.runChecks')}
        </Button>
        <BarAction
          type="button"
          variant="secondary"
          data-settings-anchor="diagnostics-export"
          icon={<Download data-icon="inline-start" aria-hidden="true" />}
          label={t('actions.exportBundle')}
          onClick={() => setPreviewOpen(true)}
        />
        {showRestart && (
          <BarAction
            type="button"
            variant="outline"
            disabled={restarting}
            icon={<RotateCw data-icon="inline-start" aria-hidden="true" />}
            label={restarting ? t('actions.restartingService') : t('actions.restartService')}
            onClick={() => void handleRestartService()}
          />
        )}
        <ConnectivitySwitch
          checked={includeConnectivity}
          onCheckedChange={setIncludeConnectivity}
        />
      </div>

      {(shellError || offlineSummary) && (
        <Item variant="muted" size="sm" role="alert">
          <ItemMedia variant="icon">
            <CircleAlert aria-hidden="true" className="text-destructive" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle className="whitespace-normal">{t('overview.serviceOffline')}</ItemTitle>
            <ItemDescription className="whitespace-normal">
              {shellError ?? offlineSummary}
            </ItemDescription>
          </ItemContent>
          {showRestart && (
            <ItemActions>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={restarting}
                onClick={() => void handleRestartService()}
              >
                {restarting ? t('actions.restartingService') : t('actions.restartService')}
              </Button>
            </ItemActions>
          )}
        </Item>
      )}

      {layers.length > 0 ? (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t('overview.summary', counts)}</span>
            {(serviceReport?.ranAt ?? shellReport?.capturedAt) && (
              <span>
                {t('overview.lastChecked', {
                  time: new Date(
                    serviceReport?.ranAt ?? shellReport?.capturedAt ?? '',
                  ).toLocaleTimeString(),
                })}
              </span>
            )}
          </div>
          {layers.map(({ layer, checks }) => (
            <div key={layer} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-foreground">{t(LAYER_KEYS[layer])}</h3>
              <ItemGroup>
                {checks.map((check) => (
                  <DoctorCheckRow
                    key={check.id}
                    check={check}
                    canRestartService={canRestartService}
                    onRestartService={() => void handleRestartService()}
                    onOpenSettingsSection={handleOpenSettingsSection}
                    onRunLiveProbe={setRequestedProbe}
                    onOpenExternalDocs={handleOpenExternalDocs}
                  />
                ))}
              </ItemGroup>
            </div>
          ))}
        </div>
      ) : running ? (
        <DoctorChecksPlaceholder label={t('overview.loadingChecks')} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('overview.noChecksYet')}</p>
      )}

      {shellReport && shellReport.rings.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-foreground">{t('rings.title')}</h3>
          <div className="flex flex-wrap gap-2">
            {shellReport.rings.map((ring) => (
              <Badge key={ring.ringId} variant="secondary">
                {t(RING_TITLE_KEYS[ring.ringId])}:{' '}
                {t('rings.summary', {
                  entries: ring.entryCount,
                  anomalies: ring.recentAnomalyCount,
                  dropped: ring.droppedCount,
                })}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <LiveProbePanel
        requestedProbe={requestedProbe}
        onRequestedProbeHandled={handleProbeHandled}
      />

      <PrivacyPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} />
    </section>
  );
}

/**
 * The run's connectivity option, at the toolbar's trailing end. Short of room it shows its switch
 * alone and names itself in a tooltip; its label stays, out of sight, as the switch's name.
 */
function ConnectivitySwitch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation('diagnostics');
  const id = useId();
  const { ref, compact } = useCompacted<HTMLDivElement>();
  const [open, setOpen] = useState(false);
  const label = t('actions.includeConnectivity');
  return (
    <Tooltip open={compact ? open : false} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <div
          ref={ref}
          data-bar-action="control"
          className="ms-auto flex shrink-0 items-center gap-2"
        >
          <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
          <span data-slot="bar-label">
            <Label htmlFor={id} className="text-sm font-normal">
              {label}
            </Label>
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
