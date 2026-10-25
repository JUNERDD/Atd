/**
 * The computer-use browser worker's smoke test: a Node runs the unpacked `computer-browser`
 * add-on's worker entry as the shell will, from the add-on's root: an MCP handshake over
 * stdin/stdout (which loads the pruned playwright-core beside it), a `capabilities` call that
 * reports the pinned playwright-core and the worker's tool set, and an exit once stdin closes.
 */
import { spawn } from 'node:child_process';
import {
  BROWSER_WORKER_TOOLS,
  BROWSER_WORKER_VERSION,
  PLAYWRIGHT_CORE_VERSION,
} from '../addons/layout.mjs';

const WORKER_TIMEOUT_MS = 20_000;

/** Runs the worker until it answered `capabilities`, then closes stdin and waits for its exit. */
function runWorker(node, root, entry, env) {
  const messages = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'verify-app', version: '1' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'capabilities', arguments: {} },
    },
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(node, [entry], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let result;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`The computer worker did not finish in ${WORKER_TIMEOUT_MS} ms: ${stderr}`));
    }, WORKER_TIMEOUT_MS);
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      for (const line of stdout.split('\n').slice(0, -1)) {
        const message = JSON.parse(line);
        if (message.id === 2 && result === undefined) {
          result = message;
          child.stdin.end();
        }
      }
      stdout = stdout.slice(stdout.lastIndexOf('\n') + 1);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (result === undefined || code !== 0)
        reject(
          new Error(
            `The computer worker exited with ${signal ?? code} before answering: ${stderr.trim()}`,
          ),
        );
      else resolve(result);
    });
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

/** Runs the worker at `entry` (absolute) with `node` from inside the add-on's `root`. */
export async function checkComputerWorker({ node, root, entry, env }) {
  const response = await runWorker(node, root, entry, env);
  const report = response.result?.structuredContent;
  const tools = Array.isArray(report?.tools) ? report.tools : [];
  if (
    report?.worker !== BROWSER_WORKER_VERSION ||
    report?.playwrightCore !== PLAYWRIGHT_CORE_VERSION ||
    tools.length !== BROWSER_WORKER_TOOLS.length ||
    !BROWSER_WORKER_TOOLS.every((tool) => tools.includes(tool))
  )
    throw new Error(`The computer worker reported ${JSON.stringify(response)}.`);
  process.stdout.write(
    `Computer worker: playwright-core ${report.playwrightCore} (${tools.length} tools), exited on stdin close\n`,
  );
}
