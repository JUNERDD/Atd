#!/usr/bin/env node
// Attach chrome-devtools-mcp to a running debuggable instance over CDP and print what it sees.
//
//   node .agents/skills/runtime-debugging/scripts/inspect.mjs [--port 9333] [--snapshot] [--console]
//
// Exits non-zero when the CDP endpoint or the page list is unreachable.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  process.stdout.write(
    'Usage: inspect.mjs [--port <port>] [--snapshot] [--console] [--url <browserUrl>]\n',
  );
  process.exit(0);
}

const browserUrl = options.url ?? `http://127.0.0.1:${options.port}`;
const server = spawn(
  'npx',
  ['-y', 'chrome-devtools-mcp@latest', '--browserUrl', browserUrl, '--no-usage-statistics'],
  { stdio: ['pipe', 'pipe', 'pipe'] },
);

const pending = new Map();
const serverLog = [];

createInterface({ input: server.stderr }).on('line', (line) => {
  serverLog.push(line);
  if (serverLog.length > 40) serverLog.shift();
});

createInterface({ input: server.stdout }).on('line', (line) => {
  if (!line.startsWith('{')) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const waiter = pending.get(message.id);
  if (waiter) {
    pending.delete(message.id);
    waiter(message);
    return;
  }
  if (message.id === undefined) responses.push(message);
});

let nextId = 1;

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out after 60s`));
    }, 60_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

async function callTool(name, args) {
  const result = await request('tools/call', { name, arguments: args ?? {} });
  const text = (result.content ?? [])
    .map((block) => block.text ?? '')
    .join('')
    .trim();
  if (result.isError) throw new Error(`${name}: ${text}`);
  return text;
}

try {
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'runtime-debugging', version: '1.0.0' },
  });
  server.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
  );

  const pages = await callTool('list_pages');
  process.stdout.write(`${pages}\n`);

  const pageId = Number(/^(\d+):/m.exec(pages)?.[1] ?? 1);

  if (options.console) {
    const console = await callTool('list_console_messages', { pageId });
    process.stdout.write(`\n${console}\n`);
  }
  if (options.snapshot) {
    const snapshot = await callTool('take_snapshot', { pageId });
    process.stdout.write(`\n${snapshot}\n`);
  }

  server.kill();
  process.exit(/^##\s+Pages/m.test(pages) && pageId ? 0 : 1);
} catch (error) {
  process.stderr.write(`inspect failed: ${error.message}\n`);
  process.stderr.write(`${serverLog.join('\n')}\n`);
  server.kill();
  process.exit(1);
}

function parseArgs(args) {
  const parsed = { port: '9333', snapshot: false, console: false, url: undefined, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--port') parsed.port = args[(index += 1)];
    else if (arg === '--url') parsed.url = args[(index += 1)];
    else if (arg === '--snapshot') parsed.snapshot = true;
    else if (arg === '--console') parsed.console = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}
