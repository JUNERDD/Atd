import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { Compile } from 'typebox/compile';
import {
  AUTOMATION_TOOL,
  AppBuildDetailsSchema,
  CONFIGURE_MCP_TOOL,
  McpServerIdSchema,
  type ProductArtifact,
} from '@atd/agent-contracts';
import { APP_TOOL } from '../apps/tool-name.js';

/**
 * The product item a completed call created or changed, for the turn's artifact cards. Each
 * tool's result already names what it saved, so the item is read from it as the session keeps
 * it, and a reload projects the same cards:
 * - `command` save and `automation` create/update answer the saved item's JSON (`id`, `name`);
 *   a save naming a `commandId`, and an automation `update`, change an existing one.
 * - `app` build: the published app (`app` details). Its first version is the build that made it.
 * - `configure_mcp`: the server id and whether the call created it, in its details.
 * - `memory_add` / `memory_replace`: the memory's id and name, in their details.
 * - Personal skills and subagents, saved through write and edit, come from the call's
 *   `app-artifact` entry (catalog-artifacts.ts) as `recorded`.
 * A result that does not read as expected projects nothing: the row stays, without a card.
 */
export function projectArtifact(
  name: string,
  args: Record<string, unknown>,
  result: ToolResultMessage,
  recorded: ProductArtifact | undefined,
): ProductArtifact | undefined {
  if (recorded) return recorded;
  switch (name) {
    case 'command':
      if (args.operation !== 'save') return undefined;
      return saved('command', textOf(result), hasId(args.commandId));
    case AUTOMATION_TOOL:
      if (args.op !== 'create' && args.op !== 'update') return undefined;
      return saved('automation', textOf(result), args.op === 'update');
    case APP_TOOL:
      return appArtifact(result.details);
    case CONFIGURE_MCP_TOOL:
      return mcpArtifact(result.details);
    case 'memory_add':
    case 'memory_replace':
      return memoryArtifact(result.details, name === 'memory_replace');
    default:
      return undefined;
  }
}

const NameSchema = Type.String({ minLength: 1, maxLength: 256 });

/** A save's answer (commands/tool.ts `savedResult`, automations/tool.ts `summary`). */
const SavedItemValidator = Compile(Type.Object({ id: NameSchema, name: NameSchema }));
const AppValidator = Compile(AppBuildDetailsSchema);
const McpValidator = Compile(Type.Object({ serverId: McpServerIdSchema, created: Type.Boolean() }));
const MemoryValidator = Compile(Type.Object({ id: NameSchema, name: NameSchema }));

function action(updated: boolean): ProductArtifact['action'] {
  return updated ? 'updated' : 'created';
}

function hasId(value: unknown): boolean {
  return typeof value === 'string' && value !== '';
}

/** The result's text as the model read it. */
function textOf(result: ToolResultMessage): string {
  return result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
}

function saved(
  kind: 'command' | 'automation',
  text: string,
  updated: boolean,
): ProductArtifact | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!SavedItemValidator.Check(value)) return undefined;
  return { kind, action: action(updated), id: value.id, name: value.name };
}

function appArtifact(details: unknown): ProductArtifact | undefined {
  if (!AppValidator.Check(details)) return undefined;
  const { appId, name, version } = details;
  return { kind: 'app', action: action(version > 1), id: appId, name };
}

function mcpArtifact(details: unknown): ProductArtifact | undefined {
  if (!McpValidator.Check(details)) return undefined;
  const { serverId, created } = details;
  return { kind: 'mcp', action: action(!created), id: serverId, name: serverId };
}

function memoryArtifact(details: unknown, updated: boolean): ProductArtifact | undefined {
  if (!MemoryValidator.Check(details)) return undefined;
  return { kind: 'memory', action: action(updated), id: details.id, name: details.name };
}
