import type { Tool } from '@earendil-works/pi-mcp';
import { say, sleep, type FakeTool, type FakeToolHandler } from './mcp-fake-server.ts';

/**
 * Tools for `FakeMcpServer` (mcp-fake-server.ts): `standardTools` mirrors test/mcp-stdio-server.mjs,
 * and the rest are the odd results the mapping and validation tests need.
 */

/** A tool with an empty-object input schema unless `definition` gives one. */
export const tool = (name: string, handler?: FakeToolHandler, definition: Partial<Tool> = {}) => ({
  definition: { name, inputSchema: { type: 'object', properties: {} }, ...definition },
  handler,
});

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
});

/** The tools of `test/mcp-stdio-server.mjs` (echo, fail, slow, structured, sample) and `hang`. */
export function standardTools(): FakeTool[] {
  const echo: FakeToolHandler = ({ text }) => ({
    content: [say(String(text))],
    structuredContent: { echoed: text },
  });
  return [
    tool('echo', echo, {
      title: 'Echo',
      inputSchema: object({ text: { type: 'string' } }, ['text']),
      annotations: { readOnlyHint: true, openWorldHint: false, title: 'Echo tool' },
    }),
    tool('fail', () => ({ content: [say('boom')], isError: true })),
    tool('structured', () => ({ content: [], structuredContent: { value: 42 } }), {
      outputSchema: object({ value: { type: 'number' } }),
    }),
    tool(
      'slow',
      async ({ steps = 3 }, ctx) => {
        for (let step = 1; step <= Number(steps) && !ctx.signal.aborted; step += 1) {
          await sleep(5);
          await ctx.progress(step, Number(steps), `step ${step}`);
        }
        return { content: [say(`done after ${steps}`)] };
      },
      { inputSchema: object({ steps: { type: 'integer' } }) },
    ),
    tool('sample', async (_args, ctx) => {
      const params = { messages: [{ role: 'user', content: say('hi') }], maxTokens: 10 };
      const reply = await ctx.session.request('sampling/createMessage', params);
      const outcome = 'error' in reply ? reply.error : reply.result;
      return { content: [say(`sampling answered ${JSON.stringify(outcome)}`)] };
    }),
    tool('hang', (_args, { signal }) => {
      return new Promise((resolve) =>
        signal.addEventListener('abort', () => resolve({ content: [] })),
      );
    }),
  ];
}

/** Answers with the arguments it received, as text and as structured content. */
export const recordingTool = (name: string, definition: Partial<Tool> = {}): FakeTool =>
  tool(name, (args) => ({ content: [say(JSON.stringify(args))], structuredContent: args }), {
    inputSchema: object({ count: { type: 'integer' }, flag: { type: 'boolean' } }, ['count']),
    ...definition,
  });

/** A tool that answers with exactly `result` (an image, a link, a blob: whatever the test needs). */
export const fixedTool = (
  name: string,
  result: Awaited<ReturnType<FakeToolHandler>>,
  definition: Partial<Tool> = {},
): FakeTool => tool(name, () => result, definition);
