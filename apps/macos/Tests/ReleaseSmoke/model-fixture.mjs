import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

export const MODEL_ID = 'atd-release-smoke';
export const FIXTURE_KEY = 'atd-ci-synthetic-key-not-a-secret';
export const ANSWER = 'Atd Intel smoke: 你好，macOS 15。';
export const FILE_CONTENT = 'Synthetic release smoke file: 中文内容。';

/** A loopback Chat Completions endpoint, never a replacement for the packaged agent service. */
export async function startModelFixture() {
  const calls = [];
  const pending = new Set();
  let mode = 'complete';
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(400);
      response.end();
    });
  });

  async function handle(request, response) {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, `Bearer ${FIXTURE_KEY}`);
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      assert.ok(raw.length < 2_000_000, 'Fixture request exceeded its bounded input');
    }
    const body = JSON.parse(raw);
    assert.equal(body.model, MODEL_ID);
    assert.ok(Array.isArray(body.messages));
    calls.push({ messages: body.messages, mode, streaming: body.stream === true });
    if (mode === 'reject') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Synthetic authentication failure' } }));
      return;
    }
    const base = { id: `smoke-${calls.length}`, created: 1, model: MODEL_ID };
    if (!body.stream) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          ...base,
          object: 'chat.completion',
          choices: [
            { index: 0, message: { role: 'assistant', content: ANSWER }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 },
        }),
      );
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const chunk = (delta, finish_reason = null) =>
      response.write(
        `data: ${JSON.stringify({
          ...base,
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta, finish_reason }],
        })}\n\n`,
      );
    if (mode === 'file') {
      const results = body.messages.filter((message) => message.role === 'tool');
      if (results.length < 2) {
        const name = results.length === 0 ? 'write' : 'read';
        assert.ok(body.tools.some((tool) => tool.function?.name === name));
        const args = {
          path: 'release-smoke.txt',
          ...(name === 'write' ? { content: FILE_CONTENT } : {}),
        };
        chunk({
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `smoke-tool-${results.length}`,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        });
        chunk({}, 'tool_calls');
        response.end('data: [DONE]\n\n');
        return;
      }
      assert.ok(JSON.stringify(results.at(-1).content).includes(FILE_CONTENT));
    }
    chunk({ role: 'assistant', content: ANSWER.slice(0, 6) });
    if (mode === 'hold') {
      // Let the test observe partial output and cancel it; no timer races or unbounded generation.
      pending.add(response);
      response.on('close', () => pending.delete(response));
      return;
    }
    chunk({ content: ANSWER.slice(6) });
    chunk({}, 'stop');
    response.end('data: [DONE]\n\n');
  }

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    calls,
    get pendingCount() {
      return pending.size;
    },
    setMode(value) {
      assert.ok(['complete', 'hold', 'reject', 'file'].includes(value));
      mode = value;
    },
    async close() {
      for (const response of pending) response.destroy();
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

export function providerRequest(baseUrl) {
  return {
    provider: 'openai-compatible',
    name: 'Release smoke fixture',
    baseUrl,
    authType: 'api_key',
    defaultModel: MODEL_ID,
    options: {},
    credential: { type: 'api_key', key: FIXTURE_KEY },
    customModels: [
      {
        id: MODEL_ID,
        name: 'Release smoke fixture',
        api: 'openai-completions',
        baseUrl,
        reasoning: false,
        input: ['text'],
        contextWindow: 128000,
        maxTokens: 256,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  };
}
