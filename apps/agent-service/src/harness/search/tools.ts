import type { Static, TSchema } from 'typebox';
import {
  createFindTool,
  createGrepTool,
  createLsTool,
  type AgentToolResult,
} from '@earendil-works/pi-coding-agent';
import { parse } from '@ai/agent-contracts';
import type { ChildTool } from '../../subagents/child-tools.js';
import { confineToolArgument, searchOperations } from './confine.js';
import { resolveRipgrep } from './ripgrep.js';

/** The read-only search tools: pi's built-ins, confined to the task folder. */
export const SEARCH_TOOL_NAMES = ['grep', 'find', 'ls'] as const;

/**
 * Checks a grep/find/ls call before the gate, for parent and child alike: the `path` argument
 * must resolve inside the task folder, and grep/find need `rg` on PATH (so pi's grep never
 * reaches its binary download).
 */
export async function precheckSearch(root: string, name: string, args: unknown): Promise<void> {
  await confineToolArgument(root, pathArgument(args));
  if (name === 'grep' || name === 'find') await resolveRipgrep();
}

/** The call's `path` argument; pi's schemas make it an optional string. */
export function pathArgument(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || !('path' in args)) return undefined;
  return typeof args.path === 'string' ? args.path : undefined;
}

interface SearchTool<T extends TSchema> {
  name: string;
  label: string;
  description: string;
  parameters: T;
  execute(id: string, params: Static<T>, signal?: AbortSignal): Promise<AgentToolResult<unknown>>;
}

/**
 * Child registrations of grep/find/ls: the same pi tools, operations and confinement as the
 * parent. Children have no confirm path, but these calls are `read:inside`, which every tier
 * allows, so the child audits the call and runs it.
 */
export function childSearchTools(
  root: string,
  allowed: readonly string[],
  audit: (tool: string) => void,
): ChildTool[] {
  const operations = searchOperations(root);
  return [
    child(createGrepTool(root, { operations: operations.grep }), root, audit),
    child(createFindTool(root, { operations: operations.find }), root, audit),
    child(createLsTool(root, { operations: operations.ls }), root, audit),
  ].filter((tool) => allowed.includes(tool.name));
}

function child<T extends TSchema>(
  tool: SearchTool<T>,
  root: string,
  audit: (tool: string) => void,
): ChildTool {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    async execute(id, args, signal) {
      signal?.throwIfAborted();
      const params = parse(tool.parameters, args);
      await precheckSearch(root, tool.name, params);
      audit(tool.name);
      const result = await tool.execute(id, params, signal);
      const content = result.content.flatMap((part) =>
        part.type === 'text' ? [{ type: 'text', text: part.text }] : [],
      );
      return { content, details: result.details ?? {} };
    },
  };
}
