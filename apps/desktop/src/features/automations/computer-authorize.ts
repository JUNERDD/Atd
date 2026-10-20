import type { TFunction } from 'i18next';
import type { AutomationItem } from '@atd/agent-contracts';
import { showErrorToast, showToast } from '../../components/toast-store';
import { failureWords } from './automation-words';
import { automationsBridge } from './use-automations';

/**
 * Asks the shell to authorize the saved automation's computer scope; the shell shows the exact
 * scope in its own dialog and records the grant only on Allow there. The outcome reads as a toast:
 * authorized, or why not (the automation changed meanwhile, no passing trial matches it, the host
 * is unavailable or another dialog is open). Dismissing the dialog says nothing. `enable` switches
 * the automation on once authorized: an edit saved for authorizing was saved off, because the
 * service refuses a switched-on computer automation its grant does not cover.
 */
export function authorizeComputer(
  item: AutomationItem,
  t: TFunction<'automations'>,
  enable = false,
) {
  const { id, revision } = item.automation;
  const bridge = automationsBridge();
  void bridge
    .authorizeComputer(id, revision)
    .then(async (result) => {
      if (!result.approved) {
        if (result.reason !== 'cancelled')
          showErrorToast(t(`computer.authorize.refused.${result.reason}`));
        return;
      }
      if (enable) await bridge.setEnabled(id, true);
      showToast({ kind: 'info', text: t('computer.authorize.approved') });
    })
    .catch((error: unknown) => showErrorToast(failureWords(error, t)));
}
