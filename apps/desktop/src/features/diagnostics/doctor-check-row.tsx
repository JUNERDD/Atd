import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DoctorRemediation, DoctorStatus, LiveProbeKind } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@atd/ui/components/collapsible';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import { IconButton } from '../../components/icon-button';
import {
  STATUS_KEYS,
  translateCheckTitle,
  translateReason,
  translateRemediation,
  translateRemediationAction,
} from './diagnostics-labels';
import type { UnifiedDoctorCheck } from './diagnostics-model';

const STATUS_BADGE_VARIANT: Record<DoctorStatus, 'secondary' | 'outline' | 'destructive'> = {
  pass: 'secondary',
  warn: 'outline',
  fail: 'destructive',
  skipped: 'outline',
};

function StatusIcon({ status }: { status: DoctorStatus }) {
  switch (status) {
    case 'pass':
      return <CheckCircle2 aria-hidden="true" className="text-foreground" />;
    case 'warn':
      return <AlertTriangle aria-hidden="true" className="text-muted-foreground" />;
    case 'fail':
      return <XCircle aria-hidden="true" className="text-destructive" />;
    case 'skipped':
      return <CircleDashed aria-hidden="true" className="text-muted-foreground" />;
  }
}

function canInvokeRemediation(remediation: DoctorRemediation): boolean {
  switch (remediation.action) {
    case 'open_system_settings_accessibility':
    case 'open_system_settings_screen_recording':
    case 'restart_service':
      return true;
    case 'open_settings_section':
      return Boolean(remediation.settingsSection);
    case 'run_live_probe':
      return Boolean(remediation.probeKind);
    case 'open_external_docs':
      return Boolean(remediation.docsUrl);
    case 'open_system_settings_input_monitoring':
    case 'open_system_settings_login_items':
    case 'move_to_applications':
    case 'relaunch_app':
    case 'none':
      return false;
  }
}

export function DoctorCheckRow({
  check,
  onRestartService,
  onOpenSettingsSection,
  onRunLiveProbe,
  onOpenExternalDocs,
}: {
  check: UnifiedDoctorCheck;
  onRestartService: () => void;
  onOpenSettingsSection: (section: string) => void;
  onRunLiveProbe: (kind: LiveProbeKind) => void;
  onOpenExternalDocs: (url: string) => void;
}) {
  const { t } = useTranslation('diagnostics');
  const [open, setOpen] = useState(false);

  const title = translateCheckTitle(t, check.id);
  const reason = translateReason(t, check.reasonCode);
  const remediation = check.remediation;
  const remediationText = remediation ? translateRemediation(t, remediation.remediationCode) : null;
  const actionLabel = remediation ? translateRemediationAction(t, remediation.action) : null;
  const showAction = Boolean(remediation && actionLabel && canInvokeRemediation(remediation));

  function handleAction() {
    if (!remediation) return;
    switch (remediation.action) {
      case 'open_system_settings_accessibility':
        void window.desktop?.settings?.requestAccessibility();
        return;
      case 'open_system_settings_screen_recording':
        void window.desktop?.settings?.requestScreenRecording();
        return;
      case 'restart_service':
        onRestartService();
        return;
      case 'open_settings_section':
        if (remediation.settingsSection) onOpenSettingsSection(remediation.settingsSection);
        return;
      case 'run_live_probe':
        if (remediation.probeKind) onRunLiveProbe(remediation.probeKind);
        return;
      case 'open_external_docs':
        if (remediation.docsUrl) onOpenExternalDocs(remediation.docsUrl);
        return;
      case 'open_system_settings_input_monitoring':
      case 'open_system_settings_login_items':
      case 'move_to_applications':
      case 'relaunch_app':
      case 'none':
        return;
    }
  }

  return (
    <Item variant="outline" size="sm" asChild>
      <li>
        <Collapsible className="w-full" open={open} onOpenChange={setOpen}>
          <div className="flex w-full flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <ItemMedia variant="icon">
                <StatusIcon status={check.status} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="whitespace-normal">{title}</ItemTitle>
                <ItemDescription className="whitespace-normal">{reason}</ItemDescription>
              </ItemContent>
            </div>
            <ItemActions className="shrink-0 flex-wrap">
              <Badge variant={STATUS_BADGE_VARIANT[check.status]}>
                {t(STATUS_KEYS[check.status])}
              </Badge>
              {showAction && actionLabel && (
                <Button type="button" variant="outline" size="sm" onClick={handleAction}>
                  {actionLabel}
                </Button>
              )}
              <CollapsibleTrigger asChild>
                <IconButton label={open ? t('checks.hideDetails') : t('checks.showDetails')}>
                  <ChevronDown
                    aria-hidden="true"
                    className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
                  />
                </IconButton>
              </CollapsibleTrigger>
            </ItemActions>
          </div>
          <CollapsibleContent className="mt-3 border-t border-border pt-3">
            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              {remediationText && <p className="text-foreground">{remediationText}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <code className="font-mono text-xs">{check.id}</code>
                <span>{t('checks.durationMs', { ms: Math.round(check.durationMs) })}</span>
              </div>
              {check.metrics.length === 0 ? (
                <p>{t('checks.noMetrics')}</p>
              ) : (
                <pre className="font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
                  {check.metrics.map(({ key, value }) => `${key}: ${value}`).join('\n')}
                </pre>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </li>
    </Item>
  );
}
