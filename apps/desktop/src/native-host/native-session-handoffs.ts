import type { AgentRequests } from '../client/agent/agent-requests';
import type { AgentChannel, AgentChannelValues } from '../client/agent/bridge-client';
import {
  AutomationSessionTargetSchema,
  parseExtensionSession,
  type AutomationSessionTarget,
  type ExtensionSession,
} from '../client/agent/session-handoff';
import { parse } from '../client/agent/validation';
import type { NativeBridge } from '../native-bridge/client';
import type { NativeCommands } from './native-commands';
import type { PageHolder } from './native-light-command';
import type { WindowMessages } from './window-messages';

export interface NativeSessionHandoffDeps {
  messages: WindowMessages;
  native: NativeBridge;
  commands: NativeCommands;
  requests: AgentRequests<PageHolder>;
  emit: <C extends AgentChannel>(channel: C, value: AgentChannelValues[C]) => void;
}

/**
 * Listens for Settings → panel session and command-launch handoffs posted over the shared
 * `BroadcastChannel`, routing valid targets into the panel's agent runtime and revealing it.
 */
export function listenNativeSessionHandoffs({
  messages,
  native,
  commands,
  requests,
  emit,
}: NativeSessionHandoffDeps): () => void {
  return messages.listen((message) => {
    if (message.type === 'launchCommand') {
      void requests.handle(message.request, 'page').catch((error: unknown) => {
        console.error('The command launched from settings could not open:', error);
      });
    } else if (message.type === 'commandSession') {
      const name = commands.list().find((item) => item.id === message.commandId)?.name ?? '';
      emit('session', { commandId: message.commandId, name });
      void native.call('window.show', {});
    } else if (message.type === 'automationSession') {
      // Like an extension session below, a message the panel cannot seed is dropped.
      let automation: AutomationSessionTarget;
      try {
        automation = parse(AutomationSessionTargetSchema, message.automation);
      } catch {
        return;
      }
      emit('automationSession', automation);
      void native.call('window.show', {});
    } else if (message.type === 'extensionSession') {
      // A window running an older build can post this too: drop a message the panel cannot seed
      // instead of throwing from the channel listener.
      let session: ExtensionSession;
      try {
        session = parseExtensionSession(message.kind, message.target);
      } catch {
        return;
      }
      emit('extensionSession', session);
      void native.call('window.show', {});
    }
  });
}
