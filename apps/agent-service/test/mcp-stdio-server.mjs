#!/usr/bin/env node
// A stdio MCP server for tests: newline-delimited JSON-RPC on stdin and stdout, no dependencies.
//
// Catalog: tools echo, fail, slow, structured and sample; env, grow and crash for launch and
// lifecycle checks; resource mem://greeting with template mem://items/{id}; prompt greet.
//
// Environment:
//   SMOKE_NAME       serverInfo.name (default "smoke-stdio").
//   SMOKE_MARKER     A file that gets one line per spawn ("<pid> <args>") and per cancelled request
//                    ("cancelled <id>"), so "nothing was spawned" is observable on disk.
//   SMOKE_ECHO_INIT  "1": the initialize result's `instructions` is the client's initialize params
//                    as JSON, which shows the capabilities and clientInfo a client declared.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const marker = process.env.SMOKE_MARKER;
const mark = (line) => {
  if (marker) appendFileSync(marker, `${line}\n`);
};
mark(`${process.pid} ${process.argv.slice(2).join(' ')}`);

const text = (value) => ({ type: 'text', text: value });
const noArguments = { type: 'object', properties: {} };
const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

const tools = [
  {
    name: 'echo',
    title: 'Echo',
    description: 'Echoes the text back.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    annotations: { readOnlyHint: true, openWorldHint: false, title: 'Echo tool' },
  },
  { name: 'fail', description: 'Always reports an error.', inputSchema: noArguments },
  {
    name: 'slow',
    description: 'Reports progress, then answers.',
    inputSchema: {
      type: 'object',
      properties: { steps: { type: 'integer' }, delayMs: { type: 'integer' } },
    },
  },
  {
    name: 'structured',
    description: 'Answers with structuredContent only.',
    inputSchema: noArguments,
    outputSchema: { type: 'object', properties: { value: { type: 'number' } } },
  },
  { name: 'sample', description: 'Asks the client to sample.', inputSchema: noArguments },
  {
    name: 'env',
    description: 'Reports the values of the named env vars, the names present, argv and cwd.',
    inputSchema: {
      type: 'object',
      properties: { names: { type: 'array', items: { type: 'string' } } },
    },
  },
  {
    name: 'grow',
    description: 'Adds one tool, resource or prompt and sends its list_changed notification.',
    inputSchema: {
      type: 'object',
      properties: { kind: { enum: ['tools', 'resources', 'prompts'] } },
    },
  },
  { name: 'crash', description: 'Exits without answering.', inputSchema: noArguments },
];
const resources = [{ uri: 'mem://greeting', name: 'greeting', mimeType: 'text/plain' }];
const templates = [{ uriTemplate: 'mem://items/{id}', name: 'item' }];
const prompts = [
  { name: 'greet', description: 'Greets someone.', arguments: [{ name: 'name', required: true }] },
];

const growth = {
  tools: () =>
    tools.push({
      name: `extra-${tools.length}`,
      description: 'Added by grow.',
      inputSchema: noArguments,
    }),
  resources: () =>
    resources.push({ uri: `mem://extra/${resources.length}`, name: `extra-${resources.length}` }),
  prompts: () => prompts.push({ name: `extra-${prompts.length}` }),
};

const toolHandlers = {
  echo: (args) => ({
    content: [text(String(args.text))],
    structuredContent: { echoed: args.text },
  }),
  fail: () => ({ content: [text('boom')], isError: true }),
  structured: () => ({ structuredContent: { value: 42 } }),
  async slow(args, ctx) {
    const steps = Number(args.steps ?? 3);
    for (let step = 1; step <= steps && !ctx.signal.aborted; step += 1) {
      await sleep(Number(args.delayMs ?? 20), ctx.signal);
      if (ctx.progressToken !== undefined && !ctx.signal.aborted) {
        send({
          jsonrpc: '2.0',
          method: 'notifications/progress',
          params: {
            progressToken: ctx.progressToken,
            progress: step,
            total: steps,
            message: `step ${step}`,
          },
        });
      }
    }
    return { content: [text(`done after ${steps}`)] };
  },
  async sample() {
    const reply = await requestClient('sampling/createMessage', {
      messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }],
      maxTokens: 10,
    });
    return { content: [text(`sampling answered ${JSON.stringify(reply.error ?? reply.result)}`)] };
  },
  env(args) {
    const names = Array.isArray(args.names) ? args.names.map(String) : [];
    const report = {
      env: Object.fromEntries(names.map((name) => [name, process.env[name] ?? null])),
      envNames: Object.keys(process.env).sort(),
      argv: process.argv.slice(2),
      cwd: process.cwd(),
    };
    return { content: [text(JSON.stringify(report))], structuredContent: report };
  },
  // The notification goes out before the answer, so a client that has the answer has also had the
  // notification: tests then only wait for its own re-listing.
  grow(args) {
    const kind = args.kind ?? 'tools';
    if (!Object.hasOwn(growth, kind))
      return { content: [text(`unknown kind ${kind}`)], isError: true };
    growth[kind]();
    send({ jsonrpc: '2.0', method: `notifications/${kind}/list_changed` });
    const counts = { tools: tools.length, resources: resources.length, prompts: prompts.length };
    return { content: [text(`grew ${kind}`)], structuredContent: counts };
  },
  // Exits after the note is flushed and never answers, so the client sees the connection close.
  crash() {
    process.stderr.write('crash requested\n', () => process.exit(3));
    return new Promise(() => {});
  },
};

async function callTool(params, ctx) {
  const name = String(params.name);
  const args = params.arguments ?? {};
  if (Object.hasOwn(toolHandlers, name)) return toolHandlers[name](args, ctx);
  if (tools.some((tool) => tool.name === name)) return { content: [text(`ran ${name}`)] };
  return { content: [text(`unknown tool ${name}`)], isError: true };
}

async function handle(method, params, ctx) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: params.protocolVersion ?? '2025-11-25',
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true },
          prompts: { listChanged: true },
        },
        serverInfo: { name: process.env.SMOKE_NAME ?? 'smoke-stdio', version: '1.0.0' },
        ...(process.env.SMOKE_ECHO_INIT === '1' ? { instructions: JSON.stringify(params) } : {}),
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools };
    case 'tools/call':
      return callTool(params, ctx);
    case 'resources/list':
      return { resources };
    case 'resources/templates/list':
      return { resourceTemplates: templates };
    case 'resources/read': {
      const uri = String(params.uri ?? '');
      if (uri === 'mem://greeting') {
        return { contents: [{ uri, mimeType: 'text/plain', text: 'hello from smoke' }] };
      }
      if (uri.startsWith('mem://items/'))
        return { contents: [{ uri, text: `item ${uri.slice(12)}` }] };
      throw Object.assign(new Error(`Resource not found: ${uri}`), { code: -32002 });
    }
    case 'prompts/list':
      return { prompts };
    case 'prompts/get':
      return {
        description: 'A greeting',
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: `Say hello to ${params.arguments?.name ?? 'someone'}.` },
          },
        ],
      };
    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

const send = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};
const inflight = new Map();
const waiting = new Map();
let nextId = 1;

/** Sends a request to the client and resolves with its response message. */
function requestClient(method, params) {
  const id = `srv-${nextId++}`;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    send({ jsonrpc: '2.0', id, method, params });
  });
}

async function serve(message) {
  const controller = new AbortController();
  inflight.set(message.id, controller);
  const ctx = {
    signal: controller.signal,
    progressToken: message.params?._meta?.progressToken,
  };
  try {
    const result = await handle(message.method, message.params ?? {}, ctx);
    if (!controller.signal.aborted) send({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) {
    const code = typeof error?.code === 'number' ? error.code : -32603;
    const failure = { code, message: String(error?.message ?? error) };
    if (!controller.signal.aborted) send({ jsonrpc: '2.0', id: message.id, error: failure });
  } finally {
    inflight.delete(message.id);
  }
}

function receive(message) {
  if (message.method === undefined) {
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  } else if (message.id !== undefined) {
    void serve(message);
  } else if (message.method === 'notifications/cancelled') {
    mark(`cancelled ${message.params?.requestId}`);
    inflight.get(message.params?.requestId)?.abort();
  }
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return; // Not JSON: ignored, as a server that only speaks the protocol would.
  }
  receive(message);
});
lines.on('close', () => process.exit(0));
