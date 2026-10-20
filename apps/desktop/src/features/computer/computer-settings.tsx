import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AddonView, TargetBinding } from '@atd/agent-contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@atd/ui/components/alert-dialog';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { showErrorToast, showToast } from '../../components/toast-store';
import { ComputerAddons } from '../addons/computer-addons';
import { useAddons } from '../addons/use-addons';
import { ExtensionLoadError } from '../service/extension-detail-fields';
import { SettingsHeading } from '../settings/settings-heading';
import { AddTargetEmpty, AddTargetMenu } from './computer-add-target';
import { ComputerApplicationDialog } from './computer-application-dialog';
import { ComputerBrowserDialog } from './computer-browser-dialog';
import { ComputerControlsCard } from './computer-controls-card';
import { ComputerStatusCard } from './computer-status-card';
import { ComputerTargetRow } from './computer-target-row';
import type { TargetKind } from './computer-target-words';
import { ComputerUnsettledNotice } from './computer-unsettled-notice';
import { ComputerVisionCard } from './computer-vision-card';
import {
  busyRun,
  computerBridge,
  refreshComputer,
  useComputerShellState,
  useComputerStatus,
} from './use-computer';

const installedIds = (addons: AddonView[] | null) =>
  new Set((addons ?? []).filter((addon) => addon.installed).map((addon) => addon.id));

/** One titled group of the page: its title over a card or the group's own state. */
function ComputerGroup({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-shortcut-group" aria-labelledby={id}>
      <h3 id={id} className="settings-section-title">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Settings › Computer use, its own section, laid out like the other settings pages: the heading
 * with Add target, the page's one primary action, whose menu picks a browser environment or an
 * application (a browser environment only once its engine is installed; the app engine is part of
 * Atd); then, under a pause notice while background computer use waits on unconfirmed actions,
 * the Engines group (the browser engine, an add-on the installer does not carry, to download or
 * remove), the Status group (what the background host and its engines can do now, the system
 * permissions they need, and Prepare screen access, so macOS asks about screen capture here
 * rather than during a task), the Targets group (the registered targets, each with Sign in again
 * for a browser environment and Disconnect, or an empty state that adds the first), and the
 * Controls group (the live pointer and Stop all). Targets are added only through the shell, which
 * prepares and registers them; disconnecting first makes the automations authorized for a target
 * stop, so the confirmation says so. Nothing shows outside the app.
 */
export function ComputerSettings({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const { available, status, error, retry } = useComputerStatus({ live: true });
  const shell = useComputerShellState();
  const installed = installedIds(useAddons().addons);
  const [adding, setAdding] = useState<TargetKind | null>(null);
  const [disconnecting, setDisconnecting] = useState<TargetBinding | null>(null);
  // The dialog keeps naming the target while it closes.
  const [shown, setShown] = useState(disconnecting);
  if (disconnecting && disconnecting !== shown) setShown(disconnecting);
  const heading = (action?: ReactNode) => (
    <SettingsHeading title={t('computer.title')} description={t('computer.description')}>
      {action}
    </SettingsHeading>
  );
  if (!available) return <section className="settings-computer-settings">{heading()}</section>;
  const bridge = computerBridge();
  const offline = !status;
  const bindings = status?.bindings ?? [];

  // The new row confirms an added target, and a removed row a plain disconnect; only what lands
  // out of sight (automations to authorize again) is said in a toast.
  function prepared() {
    setAdding(null);
    refreshComputer();
  }
  function signIn(binding: TargetBinding) {
    void bridge?.openProfile(binding.bindingId).catch(showErrorToast);
  }
  async function disconnect(binding: TargetBinding) {
    if (!bridge) return;
    try {
      const { invalidatedAutomationIds } = await bridge.removeBinding(binding.bindingId);
      refreshComputer();
      const count = invalidatedAutomationIds.length;
      if (count)
        showToast({ kind: 'info', text: t('computer.targets.disconnectedAutomations', { count }) });
    } catch (reason) {
      showErrorToast(reason);
    }
  }

  return (
    <section className="settings-computer-settings">
      {heading(<AddTargetMenu offline={offline} installed={installed} onAdd={setAdding} />)}
      <div className="settings-shortcut-groups">
        <ComputerUnsettledNotice shell={shell} />
        <ComputerGroup id="settings-computer-engines" title={t('computer.groups.engines')}>
          <div data-settings-anchor="computer-engines">
            <ComputerAddons />
          </div>
        </ComputerGroup>
        <ComputerGroup id="settings-computer-status" title={t('computer.groups.status')}>
          <ComputerStatusCard shell={shell} status={status} snapshot={snapshot} />
        </ComputerGroup>
        <ComputerGroup id="settings-computer-targets" title={t('computer.targets.title')}>
          {error && !status ? (
            <ExtensionLoadError message={error} onRetry={retry} />
          ) : bindings.length ? (
            <Card size="sm" className="settings-card" data-settings-anchor="computer-targets">
              <ItemGroup aria-labelledby="settings-computer-targets">
                {bindings.map((binding) => (
                  <ComputerTargetRow
                    key={binding.bindingId}
                    binding={binding}
                    busy={Boolean(busyRun(status, binding.bindingId))}
                    disabled={offline}
                    onSignIn={signIn}
                    onDisconnect={setDisconnecting}
                  />
                ))}
              </ItemGroup>
            </Card>
          ) : (
            <AddTargetEmpty offline={offline} installed={installed} onAdd={setAdding} />
          )}
        </ComputerGroup>
        <ComputerGroup id="settings-computer-controls" title={t('computer.groups.controls')}>
          <ComputerControlsCard shell={shell} offline={offline} />
        </ComputerGroup>
        <ComputerGroup id="settings-computer-vision" title={t('computer.vision.title')}>
          <ComputerVisionCard snapshot={snapshot} />
        </ComputerGroup>
      </div>
      <ComputerBrowserDialog
        open={adding === 'browser'}
        onOpenChange={(open) => setAdding(open ? 'browser' : null)}
        onPrepared={prepared}
      />
      <ComputerApplicationDialog
        open={adding === 'application'}
        onOpenChange={(open) => setAdding(open ? 'application' : null)}
        onPrepared={prepared}
      />
      <AlertDialog
        open={Boolean(disconnecting)}
        onOpenChange={(open) => {
          if (!open) setDisconnecting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('computer.targets.disconnectTitle', { name: shown?.label ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('computer.targets.disconnectDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('computer.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (disconnecting) void disconnect(disconnecting);
              }}
            >
              {t('computer.targets.disconnect')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
