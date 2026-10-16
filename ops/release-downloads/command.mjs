import { spawnSync } from 'node:child_process';

/** Credentials the run reads from its environment; never echoed, even in a tool's error. */
export const SENSITIVE_ENV = [
  'R2_DOWNLOAD_ACCOUNT_ID',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
];

/** Runs a CLI (gh or aws) to completion and returns its stdout, failing on a non-zero exit. */
export function command(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', maxBuffer: 16 * 1024 ** 2 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    let message = result.stderr || result.stdout;
    for (const name of SENSITIVE_ENV) {
      if (process.env[name]) message = message.replaceAll(process.env[name], '[redacted]');
    }
    throw new Error(`${executable} failed (${result.status}): ${message}`);
  }
  return result.stdout;
}
