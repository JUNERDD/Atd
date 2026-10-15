import type { FastifyInstance } from 'fastify';
import type { InvalidateFrame } from '@atd/agent-contracts';
import { onCatalogArtifactChanged } from './catalog-artifacts.js';
import { CommandStore } from './commands/store.js';
import { onMcpChanged } from './mcp/changes.js';
import { MemoryAuthority } from './memory/index.js';

/** Tool calls and background jobs change shared stores without a route response to announce it. */
export function registerStoreInvalidation(
  app: FastifyInstance,
  paths: { root: string; agentDir: string },
  notify: (frame: InvalidateFrame) => void,
): void {
  const stops = [
    MemoryAuthority.onChanged(paths.agentDir, () =>
      notify({ type: 'invalidate', scope: 'memory' }),
    ),
    CommandStore.onChanged(paths.root, () => notify({ type: 'invalidate', scope: 'commands' })),
    onMcpChanged(paths.root, () => notify({ type: 'invalidate', scope: 'extensions' })),
    onCatalogArtifactChanged(paths.root, () => notify({ type: 'invalidate', scope: 'extensions' })),
  ];
  app.addHook('onClose', async () => {
    for (const stop of stops) stop();
  });
}
