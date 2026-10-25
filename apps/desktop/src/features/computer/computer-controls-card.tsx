import { useState } from 'react';
import { CircleStop } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@atd/ui/components/item';
import { Spinner } from '@atd/ui/components/spinner';
import type { ComputerShellState } from '../../client/computer-contract';
import { showErrorToast, showToast } from '../../components/toast-store';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { computerBridge, refreshComputer } from './use-computer';
import { ComputerTypingControls } from './computer-typing-controls';

/**
 * The page-wide controls of computer use: the live pointer switch, on until turned off, and Stop
 * all, which ends every run's computer work at once. Stop all stays available whenever the service
 * answers, since which runs are busy is only read every few seconds; its outcome, runs stopped or
 * none, is said in a toast because the runs it ends are out of sight.
 */
export function ComputerControlsCard({
  shell,
  offline,
}: {
  shell: ComputerShellState | null;
  /** No service connection: nothing can be stopped. */
  offline: boolean;
}) {
  const { t } = useTranslation('settings');
  const bridge = computerBridge();
  const [pointerPending, setPointerPending] = useState(false);
  const [stopping, setStopping] = useState(false);
  function setPointer(visible: boolean) {
    if (!bridge) return;
    setPointerPending(true);
    void bridge
      .setPointerVisible(visible)
      .catch(showErrorToast)
      .finally(() => setPointerPending(false));
  }
  async function stopAll() {
    if (!bridge || stopping) return;
    setStopping(true);
    try {
      const { stoppedRunIds } = await bridge.stopAll();
      refreshComputer();
      showToast({
        kind: 'info',
        text: stoppedRunIds.length
          ? t('computer.stopAll.stopped', { count: stoppedRunIds.length })
          : t('computer.stopAll.nothing'),
      });
    } catch (reason) {
      showErrorToast(reason);
    }
    setStopping(false);
  }
  return (
    <Card size="sm" className="settings-card">
      <ItemGroup>
        <SettingsSwitchRow
          id="settings-computer-pointer"
          anchor="computer-pointer"
          title={t('computer.pointer.title')}
          description={t('computer.pointer.description')}
          checked={shell?.pointerVisible ?? true}
          pending={pointerPending}
          disabled={!bridge || !shell}
          onCheckedChange={setPointer}
        />
        <ComputerTypingControls shell={shell} />
        <Item asChild size="sm" className="settings-card-row">
          <li data-settings-anchor="computer-stop-all">
            <ItemContent className="min-w-[min(200px,100%)]">
              <ItemTitle className="whitespace-normal">{t('computer.stopAll.action')}</ItemTitle>
              <ItemDescription
                id="settings-computer-stop-description"
                className="whitespace-normal"
              >
                {t('computer.stopAll.description')}
              </ItemDescription>
            </ItemContent>
            <ItemActions className="ml-auto">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={!bridge || offline}
                aria-describedby="settings-computer-stop-description"
                aria-busy={stopping || undefined}
                aria-disabled={stopping || undefined}
                onClick={() => void stopAll()}
              >
                {stopping ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <CircleStop data-icon="inline-start" />
                )}
                {t('computer.stopAll.button')}
              </Button>
            </ItemActions>
          </li>
        </Item>
      </ItemGroup>
    </Card>
  );
}
