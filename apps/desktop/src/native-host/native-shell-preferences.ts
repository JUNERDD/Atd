import type { DesktopBridge } from '../client/contract';
import type { NativeBridge } from '../native-bridge/client';
import type { nativeSettings } from './native-settings';

type ShellPreferenceSetters = Required<
  Pick<
    DesktopBridge,
    | 'setPinned'
    | 'setShowInDock'
    | 'setOpenAtLogin'
    | 'setMiniPanelShown'
    | 'setMiniPanelOpenOn'
    | 'setPanelPlacement'
  >
>;

/**
 * The preferences the shell owns, written through it: each setter answers with what the shell
 * applied, which the settings snapshot then shows (`setShell`), so a refused or adjusted change
 * never reads as saved.
 */
export function nativeShellPreferences(
  native: NativeBridge,
  settings: Pick<ReturnType<typeof nativeSettings>, 'setShell'>,
): ShellPreferenceSetters {
  return {
    setPinned: async (pinned) => {
      const applied = await native.call('window.setPinned', { pinned });
      settings.setShell(applied);
      return applied.pinned;
    },
    setShowInDock: async (show) => {
      const applied = await native.call('app.setShowInDock', { show });
      settings.setShell({ showInDock: applied.show });
      return applied.show;
    },
    setOpenAtLogin: async (open) => {
      const applied = await native.call('app.setOpenAtLogin', { open });
      settings.setShell({ openAtLogin: applied.open });
      return applied.open;
    },
    setMiniPanelShown: async (shown) => {
      const applied = await native.call('miniPanel.setShown', { shown });
      settings.setShell({ miniPanelShown: applied.shown });
      return applied.shown;
    },
    setMiniPanelOpenOn: async (openOn) => {
      const applied = await native.call('miniPanel.setOpenOn', { openOn });
      settings.setShell({ miniPanelOpenOn: applied.openOn });
      return applied.openOn;
    },
    setPanelPlacement: async (placement) => {
      const applied = await native.call('window.setPlacement', { placement });
      settings.setShell({ panelPlacement: applied.placement });
      return applied.placement;
    },
  };
}
