import { AsyncLocalStorage } from 'node:async_hooks';
import { Type, type TSchema } from 'typebox';
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ExtensionFactory,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { ToolId } from './command-schema';
import { ToolArgumentsSchema } from './native-schema';
import { nativeCall, Nothing } from './worker-channel';
import { parse } from './validation';

export function nativeExtension(
  taskId: string,
  runId: () => string,
  cwd: string,
): ExtensionFactory {
  const calls = new AsyncLocalStorage<string>();
  const grant = () => {
    const value = calls.getStore();
    if (!value) throw new Error('A native operation requires a tool invocation.');
    return value;
  };
  const readFile = async (path: string) =>
    Buffer.from(
      await nativeCall({ action: 'read', grant: grant(), path }, Type.String()),
      'base64',
    );
  const access = async (path: string) => {
    await nativeCall({ action: 'access', grant: grant(), path }, Nothing);
  };
  const writeFile = async (path: string, content: string) => {
    await nativeCall({ action: 'write', grant: grant(), path, content }, Nothing);
  };
  function controlled<T extends TSchema, D, S>(
    tool: ToolDefinition<T, D, S>,
    name: ToolId,
  ): ToolDefinition<T, D, S> {
    return {
      ...tool,
      executionMode: 'sequential',
      async execute(id, args, signal, onUpdate, ctx) {
        if (signal?.aborted) throw new Error('Task stopped.');
        const token = await nativeCall(
          {
            action: 'authorize',
            taskId,
            runId: runId(),
            toolCallId: id,
            tool: name,
            args: parse(ToolArgumentsSchema, args),
          },
          Type.String(),
        );
        try {
          // Pi prioritizes ctx.cwd over the factory cwd. Override only this invocation,
          // keeping the session and Hermes in the app's project-free home context.
          return await calls.run(token, () =>
            tool.execute(id, args, signal, onUpdate, { ...ctx, cwd }),
          );
        } finally {
          await nativeCall({ action: 'release', grant: token }, Nothing);
        }
      },
    };
  }
  return (pi) => {
    pi.registerTool(
      controlled(createReadToolDefinition(cwd, { operations: { readFile, access } }), 'read'),
    );
    pi.registerTool(
      controlled(
        createEditToolDefinition(cwd, { operations: { readFile, writeFile, access } }),
        'edit',
      ),
    );
    pi.registerTool(
      controlled(
        createWriteToolDefinition(cwd, {
          operations: {
            writeFile,
            mkdir: async (path) => {
              await nativeCall({ action: 'mkdir', grant: grant(), path }, Nothing);
            },
          },
        }),
        'write',
      ),
    );
    pi.registerTool(
      controlled(
        createBashToolDefinition(cwd, {
          exposeSessionEnvironment: false,
          operations: {
            exec: (command, cwd, options) =>
              nativeCall(
                { action: 'shell', grant: grant(), command, cwd },
                Type.Object({ exitCode: Type.Union([Type.Number(), Type.Null()]) }),
                (data) => options.onData(Buffer.from(data, 'base64')),
              ),
          },
        }),
        'bash',
      ),
    );
  };
}
