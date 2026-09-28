import { Type, type Static } from 'typebox';
import { Identifier, McpServerConfigSchema, McpServerIdSchema } from '@ai/agent-contracts';

/**
 * MCP route request bodies (service parsing concern). Canonical placement
 * stays open until root freezes `mcp v1`; the DTOs they carry live in
 * protocol.ts (mirroring agent-contracts/mcp).
 */

const TaskScope = {
  taskId: Type.Optional(Identifier),
  runId: Type.Optional(Identifier),
  executionId: Type.Optional(Type.String({ maxLength: 256 })),
  operationId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
};

export const McpServerRequestSchema = Type.Object(
  { serverId: McpServerIdSchema, ...TaskScope },
  { additionalProperties: false },
);
export type McpServerRequest = Static<typeof McpServerRequestSchema>;

export const McpAuthCompleteRequestSchema = Type.Object(
  {
    serverId: McpServerIdSchema,
    input: Type.String({ minLength: 1, maxLength: 8192 }),
    ...TaskScope,
  },
  { additionalProperties: false },
);
export type McpAuthCompleteRequest = Static<typeof McpAuthCompleteRequestSchema>;

export const McpCallToolRequestSchema = Type.Object(
  {
    serverId: McpServerIdSchema,
    tool: Type.String({ minLength: 1, maxLength: 256 }),
    args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    ...TaskScope,
  },
  { additionalProperties: false },
);
export type McpCallToolRequest = Static<typeof McpCallToolRequestSchema>;

export const McpReadResourceRequestSchema = Type.Object(
  {
    serverId: McpServerIdSchema,
    uri: Type.String({ minLength: 1, maxLength: 2048 }),
    ...TaskScope,
  },
  { additionalProperties: false },
);
export type McpReadResourceRequest = Static<typeof McpReadResourceRequestSchema>;

export const McpGetPromptRequestSchema = Type.Object(
  {
    serverId: McpServerIdSchema,
    name: Type.String({ minLength: 1, maxLength: 256 }),
    args: Type.Optional(Type.Record(Type.String(), Type.String({ maxLength: 8192 }))),
    ...TaskScope,
  },
  { additionalProperties: false },
);
export type McpGetPromptRequest = Static<typeof McpGetPromptRequestSchema>;

export const McpConfigureRequestSchema = Type.Object(
  { servers: Type.Array(McpServerConfigSchema, { maxItems: 100 }) },
  { additionalProperties: false },
);
export type McpConfigureRequest = Static<typeof McpConfigureRequestSchema>;

/** T6b additive: per-task MCP tool selection staged for the next run. */
export const McpStageRequestSchema = Type.Object(
  {
    taskId: Identifier,
    tools: Type.Array(
      Type.Object(
        {
          connectionId: Identifier,
          tool: Type.String({ minLength: 1, maxLength: 256 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 64 },
    ),
  },
  { additionalProperties: false },
);
export type McpStageRequest = Static<typeof McpStageRequestSchema>;
