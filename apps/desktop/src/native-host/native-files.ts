import { AgentClientError, attachFileResults, searchFiles } from '@atd/agent-client';
import i18n from '../i18n';
import type { FileSearchBridge } from '../client/contract';
import type { NativeConnection } from './native-connection';

/**
 * The panel's `@` file search through the relay to the service's file routes. The window is one
 * search channel: a newer query supersedes only this window's older one, which the service answers
 * `superseded` for the file group to drop, and result ids attach only through the channel that
 * issued them. The channel lives as long as the page, so a reload starts a fresh one. Long pastes
 * the composer takes as files go to the service's resource upload.
 */
export function nativeFiles(connection: NativeConnection): FileSearchBridge {
  const channel = `panel-${crypto.randomUUID()}`;
  return {
    search: (query) =>
      searchFiles(connection.options(), { channel, ...query }).catch((error: unknown) => {
        throw failure(error, 'quickPanel.files.searchTimedOut', 'quickPanel.files.failed');
      }),
    async attach(resultIds) {
      const request = { channel, resultIds };
      const { resources } = await attachFileResults(connection.options(), request).catch(
        (error: unknown) => {
          throw failure(error, 'quickPanel.files.attachTimedOut', 'quickPanel.files.attachFailed');
        },
      );
      return resources.map(({ id, name, size, mime }) => ({ id, name, size, type: mime }));
    },
    async saveText(name, text) {
      const bytes = new TextEncoder().encode(text);
      const { resource } = await connection
        .http()
        .upload(name, 'text/plain', bytes)
        .catch((error: unknown) => {
          throw new Error(
            error instanceof AgentClientError
              ? error.message
              : i18n.t('composer.pasteNotSaved', { ns: 'panel' }),
          );
        });
      return { id: resource.id, name: resource.name, size: resource.size, type: resource.mime };
    },
  };
}

/**
 * Service messages are English and path-free, so they pass on; a request the client timed out
 * (`files-client.ts`) and other transport failures read as a retry, in the app's language.
 */
function failure(
  error: unknown,
  timedOut: 'quickPanel.files.searchTimedOut' | 'quickPanel.files.attachTimedOut',
  failed: 'quickPanel.files.failed' | 'quickPanel.files.attachFailed',
): Error {
  if (error instanceof AgentClientError) return new Error(error.message);
  // The client's deadline rejects the fetch with its signal's reason.
  const late = error instanceof DOMException && error.name === 'TimeoutError';
  return new Error(i18n.t(late ? timedOut : failed, { ns: 'panel' }));
}
