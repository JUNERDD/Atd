import { useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, CircleOff, FolderInput, Puzzle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import { Spinner } from '@atd/ui/components/spinner';
import type {
  ComputerChromeConnection,
  ComputerChromeState,
  ComputerShellState,
} from '../../client/computer-contract';
import { showErrorToast } from '../../components/toast-store';
import { ComputerChromeRow } from './computer-chrome-row';
import { StatusRow } from './computer-status-card';
import { computerBridge } from './use-computer';

/**
 * The extension flavor this build talks to: a Debug build's renderer comes from the dev server and
 * its host manifest allows only the dev flavor, a Release build's only the release flavor. Product
 * names, not translated; `folder` is where the extension's build writes that flavor.
 */
const EXTENSION = import.meta.env.DEV
  ? { name: 'Atd for Chrome (Dev)', folder: 'dist/dev' }
  : { name: 'Atd for Chrome', folder: 'dist/release' };

type HostManifest = ComputerChromeState['hostManifest'];

const MANIFEST_ICONS: Record<HostManifest, ReactNode> = {
  installed: <CircleCheck />,
  chromeMissing: <CircleOff />,
  blockedLocation: <FolderInput />,
  failed: <CircleAlert />,
};

/**
 * No Chrome profile is paired yet: how to install the extension unpacked and connect it, in the
 * order the person does it.
 */
function ChromeInstallRow() {
  const { t } = useTranslation('settings');
  const steps = [
    t('computer.chrome.install.extensions'),
    t('computer.chrome.install.load', EXTENSION),
    t('computer.chrome.install.connect', EXTENSION),
  ];
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li>
        <ItemMedia variant="icon">
          <Puzzle />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="whitespace-normal">{t('computer.chrome.install.title')}</ItemTitle>
          <ItemDescription className="whitespace-normal">
            {t('computer.chrome.install.description')}
          </ItemDescription>
          <ol className="list-decimal ps-5 text-sm text-muted-foreground">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </ItemContent>
      </li>
    </Item>
  );
}

/**
 * Settings › Computer use › Atd for Chrome: whether Chromium browsers can reach this app (the host
 * manifest the shell installs at launch and on demand), with the extension this build accepts, its
 * ID, and the discovered browsers; then one row per paired browser profile, or, before the first,
 * how to install and connect the extension. Pairing starts in the extension and is confirmed in
 * the shell's own dialog, so this page only disconnects: after a confirmation, since it also
 * removes the sites allowed from that profile. Before the shell's first report the card shows only
 * the install steps.
 */
export function ComputerChromeCard({
  shell,
  offline,
}: {
  shell: ComputerShellState | null;
  /** No service connection: disconnecting, which removes site bindings, cannot run. */
  offline: boolean;
}) {
  const { t } = useTranslation('settings');
  const [disconnecting, setDisconnecting] = useState<ComputerChromeConnection | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // The dialog keeps naming the profile while it closes.
  const [shown, setShown] = useState(disconnecting);
  if (disconnecting && disconnecting !== shown) setShown(disconnecting);
  const chrome = shell?.chrome ?? null;
  const connections = chrome?.connections ?? [];

  async function disconnect(connection: ComputerChromeConnection) {
    try {
      await computerBridge()?.disconnectChrome(connection.installationId);
    } catch (reason) {
      showErrorToast(reason);
    }
  }

  async function refresh() {
    if (refreshing) return;
    const bridge = computerBridge();
    if (!bridge) return;
    setRefreshing(true);
    try {
      await bridge.refreshChrome();
    } catch (reason) {
      showErrorToast(reason);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div data-settings-anchor="computer-chrome">
      <Card size="sm" className="settings-card">
        <ItemGroup aria-labelledby="settings-computer-chrome">
          {chrome && (
            <StatusRow
              icon={MANIFEST_ICONS[chrome.hostManifest]}
              title={t(`computer.chrome.manifest.${chrome.hostManifest}.title`)}
              description={t(
                `computer.chrome.manifest.${chrome.hostManifest}.description`,
                EXTENSION,
              )}
              note={t('computer.chrome.extension', {
                name: EXTENSION.name,
                id: chrome.extensionIds.expected,
              })}
              detail={
                chrome.browsers.length > 0
                  ? t('computer.chrome.browsers', { browsers: chrome.browsers.join(', ') })
                  : undefined
              }
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={refreshing}
                  aria-busy={refreshing || undefined}
                  onClick={() => void refresh()}
                >
                  {refreshing ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <RefreshCw data-icon="inline-start" />
                  )}
                  {t('computer.chrome.refresh')}
                </Button>
              }
            />
          )}
          {connections.length ? (
            connections.map((connection) => (
              <ComputerChromeRow
                key={connection.installationId}
                connection={connection}
                disabled={offline}
                onDisconnect={setDisconnecting}
              />
            ))
          ) : (
            <ChromeInstallRow />
          )}
        </ItemGroup>
      </Card>
      <AlertDialog
        open={Boolean(disconnecting)}
        onOpenChange={(open) => {
          if (!open) setDisconnecting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('computer.chrome.disconnectTitle', { name: shown?.label ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('computer.chrome.disconnectDescription', EXTENSION)}
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
              {t('computer.chrome.disconnect')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
