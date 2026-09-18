#!/usr/bin/env node
// Read facts from the Electron main process through its Node inspector.
//
//   pnpm --filter @ai/desktop exec electron . --inspect=9334    # main process opens the inspector
//   node .agents/skills/runtime-debugging/scripts/main-inspect.mjs --port 9334 --expression "process.pid"
//
// The main process is not a Chromium page, so the renderer tools (chrome-devtools-mcp, CDP page
// targets) cannot see it. This talks to the Node inspector instead. Exits non-zero on failure.

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  process.stdout.write(
    'Usage: main-inspect.mjs [--port 9334] [--expression <js>] [--timeout <seconds>]\n',
  );
  process.exit(0);
}

const listUrl = `http://127.0.0.1:${options.port}/json/list`;

try {
  const targets = await (await fetch(listUrl)).json();
  const target = targets.find((entry) => entry.webSocketDebuggerUrl);
  if (!target) throw new Error(`no inspector target at ${listUrl}`);

  const value = await evaluate(target.webSocketDebuggerUrl, options.expression, options.timeout);
  process.stdout.write(`${String(value)}\n`);
  process.exit(0);
} catch (error) {
  process.stderr.write(`main-inspect failed: ${error.message}\n`);
  process.exit(1);
}

function evaluate(webSocketUrl, expression, timeoutSeconds) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`evaluate timed out after ${timeoutSeconds}s`));
    }, timeoutSeconds * 1000);

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      );
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('could not open the inspector socket'));
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) reject(new Error(message.error.message));
      else if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.text));
      } else resolve(message.result?.result?.value);
    });
  });
}

function parseArgs(args) {
  const parsed = {
    port: '9334',
    expression: 'JSON.stringify({ pid: process.pid, electron: process.versions.electron })',
    timeout: 15,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--port') parsed.port = args[(index += 1)];
    else if (arg === '--expression') parsed.expression = args[(index += 1)];
    else if (arg === '--timeout') parsed.timeout = Number(args[(index += 1)]);
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}
