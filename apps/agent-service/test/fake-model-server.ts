import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * An OpenAI-compatible chat completions endpoint on loopback that streams one scripted answer per
 * request. The service reaches it as its temporary connection (`AI_AGENT_TEMP_*`), so a test runs
 * a real task run end to end (acceptance, the Pi session, the model stream) without a provider.
 * `reply` sees the last user message of each request.
 */
export async function fakeModelServer(reply: (prompt: string) => string | Promise<string>) {
  const prompts: string[] = [];
  /** Every request body as sent. */
  const bodies: string[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    request.on('end', () => {
      void (async () => {
        bodies.push(body);
        const prompt = lastUserText(JSON.parse(body || '{}'));
        prompts.push(prompt);
        const text = await reply(prompt);
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        });
        const chunk = (fields: object) =>
          response.write(
            `data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', created: 0, model: 'fake-model', ...fields })}\n\n`,
          );
        chunk({
          choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
        });
        chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
        chunk({
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
        });
        response.end('data: [DONE]\n\n');
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    prompts,
    bodies,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function lastUserText(body: unknown): string {
  const messages = (body as { messages?: Array<{ role?: string; content?: unknown }> }).messages;
  const user = [...(messages ?? [])].reverse().find((message) => message.role === 'user');
  const content = user?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: unknown) => (part as { text?: unknown }).text)
    .filter((text): text is string => typeof text === 'string')
    .join('\n');
}
