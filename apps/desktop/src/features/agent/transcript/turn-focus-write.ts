import { useSyncExternalStore } from 'react';
import type {
  FocusWriteBridge,
  FocusedWriteRequest,
  WriteOffer,
} from '../../../client/agent/bridge';
import { showToast } from '../../../components/toast-store';
import { refusalText, typingSettings, type WriteRefusal } from '../command-answer';
import { agentApi } from '../use-agent';

const noOffer = () => null;
const noSubscription = () => () => undefined;

/** The panel's writes where the person's focus is now, and what that focus offers. */
export interface FocusWrite {
  bridge: FocusWriteBridge;
  offer: WriteOffer;
}

/**
 * Where the person's focus is now, as the shell offers it to the panel's write buttons
 * (`text.writeOffer`): null while it cannot take text, the panel is hidden, or the page has no
 * shell to follow it.
 */
export function useFocusWrite(): FocusWrite | null {
  const bridge = window.desktop?.agent?.focusWrite;
  const offer = useSyncExternalStore(bridge?.onOffer ?? noSubscription, bridge?.offer ?? noOffer);
  return bridge && offer ? { bridge, offer } : null;
}

/**
 * Writes `answer` through `bridge` where the person's focus is now, in `app`
 * (`text.writeFocused`, which captures that field afresh): the shell hides the panel and confirms
 * the write by showing it, so success says nothing more. Otherwise the whole answer goes on the
 * clipboard, and a warning says why in one sentence, as a write into a command's recorded field
 * does.
 */
export async function writeAtFocus(
  bridge: FocusWriteBridge,
  answer: string,
  mode: FocusedWriteRequest['mode'],
  app: string,
): Promise<void> {
  let reason: WriteRefusal;
  try {
    const result = await bridge.write({ mode, text: answer, ...(await typingSettings()) });
    if (result.ok) return;
    reason = result.reason;
  } catch (error) {
    console.error('The native shell did not write the answer:', error);
    reason = 'failed';
  }
  await agentApi().copy(answer);
  showToast({ kind: 'warning', text: refusalText(reason, app) });
}
