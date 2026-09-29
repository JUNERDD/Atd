#!/usr/bin/env node
/**
 * Runs the given command on macOS and skips it elsewhere, so `pnpm check` stays green on Linux
 * CI while still covering the Swift shell and the Rust crates locally. The macOS CI job runs
 * those checks directly (`.github/workflows/ci.yml`).
 *
 * Usage: node scripts/on-macos.mjs <command> [args...]
 */
import { spawnSync } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/on-macos.mjs <command> [args...]');
  process.exit(1);
}
if (process.platform !== 'darwin') {
  console.log(`Skipping macOS-only checks on ${process.platform}: ${[command, ...args].join(' ')}`);
  process.exit(0);
}
const result = spawnSync(command, args, { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
