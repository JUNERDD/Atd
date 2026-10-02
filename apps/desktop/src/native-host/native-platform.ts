import { downloadResource } from '@atd/agent-client';
import type { AgentPlatform } from '../client/agent/agent-requests';
import type { PreparedCommand } from '../client/agent/bridge';
import type { NativeBridge } from '../native-bridge/client';

/**
 * Host abilities through the shell: its open panel (which also imports the picked files), its save
 * panel for the page's content, the pasteboard, the default browser, and artifact files on disk.
 */
export function nativePlatform(
  bridge: NativeBridge,
  launch: (prepared: PreparedCommand, autoRun: boolean) => void,
): AgentPlatform {
  return {
    async chooseFiles() {
      const { resources } = await bridge.call('files.pick', {});
      return resources;
    },
    async copy(text) {
      await bridge.call('clipboard.write', { text });
    },
    async openLink(url) {
      await bridge.call('link.open', { url });
    },
    async saveFile(name, content) {
      const { saved } = await bridge.call('files.save', { name, content });
      return saved;
    },
    async artifact(options, artifactId, operation) {
      // Attaching needs only the file's description, which the page reads through the relay.
      if (operation === 'attach') {
        const downloaded = await downloadResource(options, artifactId);
        return {
          id: artifactId,
          name: downloaded.name,
          size: downloaded.bytes.length,
          type: downloaded.mime,
        };
      }
      return bridge.call('artifact', {
        artifactId,
        operation: operation === 'copy' ? 'copyPath' : operation === 'open' ? 'open' : 'reveal',
      });
    },
    launch,
  };
}
