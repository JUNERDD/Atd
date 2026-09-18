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
import {
  CommandSaveResultSchema,
  CommandSchema,
  CommandSummarySchema,
  CommandToolParametersSchema,
  CommandToolSchema,
  type CommandToolArguments,
  type ToolId,
} from './command-schema';
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

export function commandExtension(taskId: string, runId: () => string): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: 'command',
      label: 'Manage commands',
      description:
        'List, read, create or update saved commands. Use "list" for the saved commands, "get" with a commandId for one definition, and "save" with fields. To update, pass the commandId together with the expectedRevision you read; to create, omit commandId (or pass null) and omit expectedRevision. Every save is confirmed by the user.',
      parameters: CommandToolParametersSchema,
      executionMode: 'sequential',
      async execute(id, args) {
        const value = await commandNativeCall(
          { taskId, runId: runId(), toolCallId: id },
          parse(CommandToolSchema, args),
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
          details: {},
        };
      },
    });
  };
}

function commandNativeCall(
  scope: { taskId: string; runId: string; toolCallId: string },
  operation: CommandToolArguments,
) {
  switch (operation.operation) {
    case 'list':
      return nativeCall(
        { action: 'commandList', taskId: scope.taskId, runId: scope.runId },
        Type.Array(CommandSummarySchema),
      );
    case 'get':
      return nativeCall(
        {
          action: 'commandGet',
          taskId: scope.taskId,
          runId: scope.runId,
          commandId: operation.commandId,
        },
        CommandSchema,
      );
    case 'save':
      return nativeCall(
        {
          action: 'commandSave',
          taskId: scope.taskId,
          runId: scope.runId,
          toolCallId: scope.toolCallId,
          commandId: operation.commandId,
          expectedRevision: operation.expectedRevision,
          fields: operation.fields,
        },
        CommandSaveResultSchema,
      );
    default: {
      const _exhaustive: never = operation;
      return _exhaustive;
    }
  }
}
