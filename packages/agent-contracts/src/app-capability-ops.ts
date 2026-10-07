import { Type, type Static, type TSchema } from 'typebox';
import { CommandToolSchema } from './commands.js';
import { Identifier } from './identifiers.js';
import { McpServerIdSchema } from './mcp.js';
import { MemoryEntrySchema, MemoryTargetSchema } from './memory.js';
import { SkillName } from './skills.js';
import { RunStatusSchema } from './task.js';
import { WebSearchResultSchema } from './tool-details.js';

/**
 * The capability operations an app backend asks its parent for (`ctx.ai`, `ctx.agent`,
 * `ctx.memory`, `ctx.mcp`, `ctx.web`): one input, an optional chunk and one output schema per
 * operation. The IPC `cap` message carries `cap` and `op` separately (`{ cap: 'ai', op:
 * 'generate' }`); `<cap>.<op>` is the operation's full name. Streaming operations answer with
 * `capChunk` messages before their `capResult`.
 */

const Text = (maxLength: number) => Type.String({ maxLength });

export const AiMessageSchema = Type.Object(
  {
    role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
    content: Text(200000),
  },
  { additionalProperties: false },
);
export type AiMessage = Static<typeof AiMessageSchema>;

/**
 * `ai.generate` and `ai.stream` input. `model` is a model id of one of the user's connections
 * (the default connection's default model when absent); `system` is the system prompt.
 */
export const AiGenerateInputSchema = Type.Object(
  {
    messages: Type.Array(AiMessageSchema, { minItems: 1, maxItems: 200 }),
    model: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    maxTokens: Type.Optional(Type.Integer({ minimum: 1, maximum: 200000 })),
    system: Type.Optional(Text(100000)),
  },
  { additionalProperties: false },
);
export type AiGenerateInput = Static<typeof AiGenerateInputSchema>;

export const AiGenerateOutputSchema = Type.Object(
  {
    text: Type.String(),
    /** The model id that answered. */
    model: Type.String({ maxLength: 256 }),
    usage: Type.Optional(
      Type.Object(
        {
          inputTokens: Type.Integer({ minimum: 0 }),
          outputTokens: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type AiGenerateOutput = Static<typeof AiGenerateOutputSchema>;

/** One `ai.stream` chunk: the next piece of the answer text. */
export const AiStreamChunkSchema = Type.Object(
  { type: Type.Literal('text'), delta: Type.String() },
  { additionalProperties: false },
);
export type AiStreamChunk = Static<typeof AiStreamChunkSchema>;

/**
 * `agent.run` input: the prompt of a new task (origin `{ kind: 'app', appId }`). `tools` narrows
 * the default tool set; `skills` are staged for the run. Guarded tools still ask through the
 * task's confirms.
 */
export const AgentRunInputSchema = Type.Object(
  {
    prompt: Type.String({ minLength: 1, maxLength: 100000 }),
    tools: Type.Optional(Type.Array(CommandToolSchema, { maxItems: 5, uniqueItems: true })),
    skills: Type.Optional(Type.Array(SkillName, { maxItems: 16, uniqueItems: true })),
  },
  { additionalProperties: false },
);
export type AgentRunInput = Static<typeof AgentRunInputSchema>;

/** One `agent.run` chunk: answer text, a tool call's progress, or the run's status. */
export const AgentRunChunkSchema = Type.Union([
  Type.Object(
    { type: Type.Literal('text'), delta: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('tool'),
      name: Type.String({ maxLength: 128 }),
      status: Type.Union([
        Type.Literal('running'),
        Type.Literal('completed'),
        Type.Literal('failed'),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal('status'), status: RunStatusSchema },
    { additionalProperties: false },
  ),
]);
export type AgentRunChunk = Static<typeof AgentRunChunkSchema>;

export const AgentRunOutputSchema = Type.Object(
  { taskId: Identifier, runId: Identifier, status: RunStatusSchema, text: Type.String() },
  { additionalProperties: false },
);
export type AgentRunOutput = Static<typeof AgentRunOutputSchema>;

const MemoryEntries = Type.Object(
  { entries: Type.Array(MemoryEntrySchema, { maxItems: 200 }) },
  { additionalProperties: false },
);

export const MemorySearchInputSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 1000 }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  },
  { additionalProperties: false },
);
export type MemorySearchInput = Static<typeof MemorySearchInputSchema>;

/** `memory.read`: every entry of `target`, or of every target when absent. */
export const MemoryReadInputSchema = Type.Object(
  { target: Type.Optional(MemoryTargetSchema) },
  { additionalProperties: false },
);
export type MemoryReadInput = Static<typeof MemoryReadInputSchema>;

/** `memory.write`: adds one entry to the agent's (`memory`) or the user's (`user`) memory. */
export const MemoryWriteInputSchema = Type.Object(
  {
    target: Type.Union([Type.Literal('memory'), Type.Literal('user')]),
    content: Type.String({ minLength: 1, maxLength: 20000 }),
  },
  { additionalProperties: false },
);
export type MemoryWriteInput = Static<typeof MemoryWriteInputSchema>;

/** `mcp.listTools`: the tools of one server, or of every enabled server when absent. */
export const McpListToolsInputSchema = Type.Object(
  { serverId: Type.Optional(McpServerIdSchema) },
  { additionalProperties: false },
);
export type McpListToolsInput = Static<typeof McpListToolsInputSchema>;

export const AppMcpToolSchema = Type.Object(
  {
    serverId: McpServerIdSchema,
    name: Type.String({ maxLength: 256 }),
    title: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
    description: Type.Union([Type.String({ maxLength: 8000 }), Type.Null()]),
    inputSchema: Type.Unknown(),
  },
  { additionalProperties: false },
);
export type AppMcpTool = Static<typeof AppMcpToolSchema>;

export const McpCallToolInputSchema = Type.Object(
  {
    serverId: McpServerIdSchema,
    name: Type.String({ minLength: 1, maxLength: 256 }),
    arguments: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);
export type McpCallToolInput = Static<typeof McpCallToolInputSchema>;

/** The MCP `CallToolResult` as the server returned it. */
export const McpCallToolOutputSchema = Type.Object(
  {
    content: Type.Array(Type.Unknown()),
    structuredContent: Type.Optional(Type.Unknown()),
    isError: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type McpCallToolOutput = Static<typeof McpCallToolOutputSchema>;

export const WebSearchInputSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 500 }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  },
  { additionalProperties: false },
);
export type WebSearchInput = Static<typeof WebSearchInputSchema>;

export const WebFetchInputSchema = Type.Object(
  { url: Type.String({ minLength: 1, maxLength: 2048, pattern: '^https?://' }) },
  { additionalProperties: false },
);
export type WebFetchInput = Static<typeof WebFetchInputSchema>;

/** The page's extracted text; `url` is the final URL after redirects. */
export const WebFetchOutputSchema = Type.Object(
  { url: Type.String({ maxLength: 2048 }), title: Text(300), text: Text(1000000) },
  { additionalProperties: false },
);
export type WebFetchOutput = Static<typeof WebFetchOutputSchema>;

interface CapabilityOp {
  input: TSchema;
  output: TSchema;
  /** Present for streaming operations: the schema of each `capChunk`. */
  chunk?: TSchema;
}

/** Every v1 capability operation by full name (`<cap>.<op>`). */
export const APP_CAPABILITY_OPS = {
  'ai.generate': { input: AiGenerateInputSchema, output: AiGenerateOutputSchema },
  'ai.stream': {
    input: AiGenerateInputSchema,
    output: AiGenerateOutputSchema,
    chunk: AiStreamChunkSchema,
  },
  'agent.run': {
    input: AgentRunInputSchema,
    output: AgentRunOutputSchema,
    chunk: AgentRunChunkSchema,
  },
  'memory.search': { input: MemorySearchInputSchema, output: MemoryEntries },
  'memory.read': { input: MemoryReadInputSchema, output: MemoryEntries },
  'memory.write': {
    input: MemoryWriteInputSchema,
    output: Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false }),
  },
  'mcp.listTools': {
    input: McpListToolsInputSchema,
    output: Type.Object(
      { tools: Type.Array(AppMcpToolSchema, { maxItems: 1000 }) },
      { additionalProperties: false },
    ),
  },
  'mcp.callTool': { input: McpCallToolInputSchema, output: McpCallToolOutputSchema },
  'web.search': {
    input: WebSearchInputSchema,
    output: Type.Object(
      { results: Type.Array(WebSearchResultSchema, { maxItems: 20 }) },
      { additionalProperties: false },
    ),
  },
  'web.fetch': { input: WebFetchInputSchema, output: WebFetchOutputSchema },
} as const satisfies Record<string, CapabilityOp>;

export type AppCapabilityOpName = keyof typeof APP_CAPABILITY_OPS;
export type AppCapabilityOpInput<N extends AppCapabilityOpName> = Static<
  (typeof APP_CAPABILITY_OPS)[N]['input']
>;
export type AppCapabilityOpOutput<N extends AppCapabilityOpName> = Static<
  (typeof APP_CAPABILITY_OPS)[N]['output']
>;
