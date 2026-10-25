#!/usr/bin/env node
import './dev-guard.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareDevNativeCache } from './dev-native-cache.mjs';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--headless')) throw new Error('Usage: dev.mjs [--headless]');
const config = await prepareDevNativeCache();
const targets = ['@atd/agent-service#dev', '@atd/desktop#dev:renderer'];
if (!args.includes('--headless')) targets.push('@atd/macos#dev');

// Keep Turbo in its own group so a terminal interrupt reaches it exactly once. Turbo owns
// task shutdown, including releasing the service lock and stopping the app it opened.
const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/turbo/bin/turbo', import.meta.url)),
    'watch',
    ...targets,
    `--root-turbo-json=${config}`,
    '--experimental-write-cache',
    '--output-logs=new-only',
    '--continue=dependencies-successful',
  ],
  { stdio: 'inherit', detached: process.platform !== 'win32' },
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  try {
    if (process.platform === 'win32') child.kill('SIGINT');
    else process.kill(-child.pid, 'SIGINT');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop);
child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('close', (code) => {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(signal, stop);
  process.exitCode = code ?? (stopping ? 0 : 1);
});
