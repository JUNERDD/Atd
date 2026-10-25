import type { ReactNode } from 'react';
import {
  AppWindow,
  CircleCheck,
  CircleDashed,
  CircleOff,
  Globe,
  Lock,
  Monitor,
  ScanEye,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CapabilityProfile, ComputerStatusResponse } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import { Spinner } from '@atd/ui/components/spinner';
import type { ComputerShellState } from '../../client/computer-contract';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { showErrorToast } from '../../components/toast-store';
import { useCaptureConsent, type CaptureConsentView } from './use-capture-consent';

type HostState = ComputerShellState['host'];

const HOST_ICONS: Record<HostState, ReactNode> = {
  ready: <CircleCheck />,
  starting: <CircleDashed />,
  locked: <Lock />,
  unavailable: <CircleOff />,
};

/**
 * One row of the card: an icon, a title and a wrapping description, and at the trailing edge an
 * optional action or a secondary value such as an engine's version. The text keeps at least
 * 200px, as in the other settings cards, so a trailing part that does not fit beside it moves
 * below instead of squeezing it. `note` adds a line of what it can do; `detail` is the shell's own
 * words for a failure: kept to two lines so a long path or error cannot flood the card, with the
 * whole text on hover.
 */
function StatusRow({
  icon,
  title,
  description,
  note,
  detail,
  action,
  anchor,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  note?: string | undefined;
  detail?: string | undefined;
  action?: ReactNode;
  anchor?: string;
}) {
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li data-settings-anchor={anchor}>
        <ItemMedia variant="icon">{icon}</ItemMedia>
        <ItemContent className="min-w-[min(200px,100%)]">
          <ItemTitle className="whitespace-normal">{title}</ItemTitle>
          <ItemDescription className="whitespace-normal">{description}</ItemDescription>
          {note ? (
            <ItemDescription className="text-xs whitespace-normal">{note}</ItemDescription>
          ) : null}
          {detail ? (
            <ItemDescription
              className="line-clamp-2 text-xs break-words whitespace-normal"
              title={detail}
            >
              {detail}
            </ItemDescription>
          ) : null}
        </ItemContent>
        {action && <ItemActions className="ml-auto">{action}</ItemActions>}
      </li>
    </Item>
  );
}

/**
 * Screen access: whether screen capture was prepared for this app build, with the one action that
 * prepares it (again), so macOS asks here and never in the middle of a task. The description says
 * which state the row is in; the button keeps one label and one icon slot, which shows a spinner
 * while macOS may be asking, so it has the same width in every state and sits in the same place:
 * beside the text where both fit, below it where they do not.
 */
function CaptureConsentRow({ shell }: { shell: ComputerShellState }) {
  const { t, i18n } = useTranslation('settings');
  const { view, prepare, available } = useCaptureConsent(shell);
  const description = (view: CaptureConsentView) => {
    switch (view.phase) {
      case 'notPrepared':
        return t('computer.capture.notPrepared');
      case 'preparing':
        return t('computer.capture.preparing');
      case 'prepared': {
        const time = new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(view.primedAt));
        return t('computer.capture.prepared', { time });
      }
      case 'failed':
        return t(`computer.capture.${view.reason}`);
    }
  };
  const preparing = view.phase === 'preparing';
  return (
    <StatusRow
      anchor="computer-capture"
      icon={<Monitor />}
      title={t('computer.capture.title')}
      description={description(view)}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!available}
          aria-busy={preparing || undefined}
          aria-disabled={preparing || undefined}
          onClick={() => void prepare()}
        >
          {preparing ? <Spinner data-icon="inline-start" /> : <ScanEye data-icon="inline-start" />}
          {t('computer.capture.prepare')}
        </Button>
      }
    />
  );
}

/**
 * What computer use can do right now: the host (ready, held by another Atd, starting or
 * unavailable), each engine's readiness with its version at the trailing edge, what its published
 * profile can do in plain words (in the background, also in the foreground where its host can fall
 * back to it for a task, and whether it was checked for automations, unless its state already says
 * it was not) and, when it failed, the shell's own words; the system permissions apps need with
 * the way to System Settings (Accessibility also when macOS withholds posting input to apps, which
 * System Settings lists under it); and Screen access once the shell reports its state. The shell
 * reports the host and engines; before its first report the service's view stands in.
 */
export function ComputerStatusCard({
  shell,
  status,
  snapshot,
}: {
  shell: ComputerShellState | null;
  status: ComputerStatusResponse | null;
  snapshot: SettingsSnapshot | null;
}) {
  const { t } = useTranslation('settings');
  const settings = window.desktop?.settings;
  const host: HostState = shell?.host ?? status?.host.state ?? 'unavailable';
  const engines = (shell?.engines ?? []).filter((engine) => engine.state !== 'notInstalled');
  const profiles = new Map(
    (status?.host.profiles ?? []).map((profile) => [profile.engine, profile]),
  );
  // Every engine works in the background; the profile says whether its host can also fall back to
  // the foreground for a task. The note says how it delivers and how it was checked.
  const capability = (profile: CapabilityProfile | undefined, unqualified: boolean) => {
    if (!profile) return undefined;
    const delivery = t(
      profile.delivery.includes('foreground')
        ? 'computer.capability.backgroundAndForeground'
        : 'computer.capability.background',
    );
    if (unqualified) return delivery;
    return `${delivery} · ${t(`computer.capability.${profile.qualification}`)}`;
  };
  const permission = (
    key: 'accessibility' | 'screenRecording',
    missing: boolean,
    request: (() => Promise<void>) | undefined,
  ) =>
    missing && (
      <StatusRow
        icon={<ShieldAlert />}
        title={t(`computer.permission.${key}.title`)}
        description={t(`computer.permission.${key}.description`)}
        action={
          request && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void request().catch(showErrorToast)}
            >
              {t('computer.permission.open')}
            </Button>
          )
        }
      />
    );
  return (
    <Card size="sm" className="settings-card">
      <ItemGroup aria-label={t('computer.statusLabel')}>
        <StatusRow
          anchor="computer-status"
          icon={HOST_ICONS[host]}
          title={t(`computer.host.${host}.title`)}
          description={t(`computer.host.${host}.description`)}
        />
        {/* The browser engine shows only in the Engines group above while its add-on is absent. */}
        {engines.map((engine) => {
          const profile = profiles.get(engine.engine);
          const version = profile?.engineVersion;
          return (
            <StatusRow
              key={engine.engine}
              icon={engine.engine === 'playwright' ? <Globe /> : <AppWindow />}
              title={t(`computer.engine.${engine.engine}`)}
              description={t(`computer.engineState.${engine.state}`)}
              note={capability(profile, engine.state === 'unqualified')}
              detail={engine.detail || undefined}
              action={
                version && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t('computer.engineVersion', { version })}
                  </span>
                )
              }
            />
          );
        })}
        {permission(
          'accessibility',
          snapshot?.accessibilityTrusted === false || shell?.postEventAccess === false,
          settings?.requestAccessibility,
        )}
        {permission(
          'screenRecording',
          snapshot?.screenRecordingTrusted === false,
          settings?.requestScreenRecording,
        )}
        {shell && <CaptureConsentRow shell={shell} />}
      </ItemGroup>
    </Card>
  );
}
