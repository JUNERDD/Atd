import { enableCompileCache } from 'node:module';
import { ensureDevAddons } from './ensure-dev-addons.mjs';

// Enable before loading the service graph so restarts can reuse its compiled modules.
enableCompileCache();
await ensureDevAddons();
await import('../dist/cli.js');
