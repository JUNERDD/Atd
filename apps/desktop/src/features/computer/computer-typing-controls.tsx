import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'motion/react';
import type { ComputerShellState } from '../../client/computer-contract';
import { showErrorToast } from '../../components/toast-store';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { computerBridge } from './use-computer';

/** Both switches share the shell snapshot, including the first typing opt-in's highlight. */
export function ComputerTypingControls({ shell }: { shell: ComputerShellState | null }) {
  const { t } = useTranslation('settings');
  const reduced = useReducedMotion();
  const controls = useComputerTyping(shell);
  return (
    <>
      <SettingsSwitchRow
        id="settings-computer-typing"
        anchor="computer-typing"
        title={t('computer.typing.title')}
        description={t(reduced ? 'computer.typing.reducedMotion' : 'computer.typing.description')}
        checked={shell?.typing ?? false}
        pending={controls.pending !== null}
        disabled={controls.disabled}
        onCheckedChange={(value) => void controls.change('typing', value)}
      />
      <SettingsSwitchRow
        id="settings-computer-typing-animation"
        anchor="computer-typing-animation"
        title={t('computer.typingAnimation.title')}
        description={t('computer.typingAnimation.description')}
        checked={shell?.typingAnimation ?? false}
        pending={controls.pending !== null}
        disabled={controls.disabled}
        onCheckedChange={(value) => void controls.change('animation', value)}
      />
    </>
  );
}

function useComputerTyping(shell: ComputerShellState | null) {
  const bridge = computerBridge();
  const [pending, setPending] = useState<'typing' | 'animation' | null>(null);
  async function change(setting: 'typing' | 'animation', enabled: boolean) {
    if (!bridge || !shell || pending) return;
    setPending(setting);
    try {
      await bridge.setTyping(setting, enabled);
    } catch (error) {
      showErrorToast(error);
    } finally {
      setPending(null);
    }
  }
  return { pending, disabled: !bridge || !shell, change };
}
