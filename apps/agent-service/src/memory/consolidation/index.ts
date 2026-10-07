import type { Logger } from '../../logging.js';
import type { ServicePaths } from '../../storage.js';
import { logMemoryEvents, MemoryAuthority } from '../engine.js';
import { consolidate } from './job.js';
import { connectionModels } from './model.js';
import type { ConsolidateMemory } from './types.js';

export type { ConsolidateMemory, ConsolidationRequest, ConsolidationResult } from './types.js';

export interface ConsolidatorDeps {
  paths: ServicePaths;
  log: Logger;
}

/**
 * The memory engine's consolidation job for the service's data dir (job.ts): it reviews the
 * enabled memories through the data dir's memory authority, on the saved provider connections
 * (model.ts), and is the engine's own work, not an agent task.
 */
export function createMemoryConsolidator(deps: ConsolidatorDeps): ConsolidateMemory {
  const { agentDir } = deps.paths;
  const job = {
    agentDir,
    authority: () => MemoryAuthority.authorityFor(agentDir, logMemoryEvents(deps.log)),
    openModel: connectionModels(deps.paths),
    log: deps.log,
  };
  return (request) => consolidate(job, request);
}
