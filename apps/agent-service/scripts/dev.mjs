import { enableCompileCache } from 'node:module';

// Enable before loading the service graph so restarts can reuse its compiled modules.
enableCompileCache();
await import('../dist/cli.js');
