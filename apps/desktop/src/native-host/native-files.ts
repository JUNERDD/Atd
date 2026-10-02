import { AgentClientError, attachFileResults, searchFiles } from '@atd/agent-client';
import type { FileSearchBridge } from '../client/contract';
import type { NativeConnection } from './native-connection';

/**
 * The panel's `@` file search through the relay to the service's file routes. The window is one
 * search channel: a newer query supersedes only this window's older one, which the service answers
 * `superseded` for the file group to drop, and result ids attach only through the channel that
 * issued them. The channel lives as long as the page, so a reload starts a fresh one.
 */
export function nativeFiles(connection: NativeConnection): FileSearchBridge {
  const channel = `panel-${crypto.randomUUID()}`;
  return {
    search: (query) => searchFiles(connection.options(), { channel, ...query }).catch(rethrow),
    async attach(resultIds) {
      const request = { channel, resultIds };
      const { resources } = await attachFileResults(connection.options(), request).catch(rethrow);
      return resources.map(({ id, name, size, mime }) => ({ id, name, size, type: mime }));
    },
  };
}

/** Service messages are English and path-free; transport failures read as a generic retry. */
function rethrow(error: unknown): never {
  throw new Error(
    error instanceof AgentClientError ? error.message : 'File search failed. Try again.',
  );
}
