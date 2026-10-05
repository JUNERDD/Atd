import { getCurrentSystemMessage, type SystemMessage, type Tool } from '@earendil-works/pi-ai';
import { estimateTokens, type SessionProjection } from '@earendil-works/pi-coding-agent';
import {
  MEMORY_READ_TOOLS,
  MEMORY_WRITE_TOOLS,
  type ContextBreakdown,
  type ContextBreakdownCategory,
  type ContextBreakdownItem,
} from '@atd/agent-contracts';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { mcpProxyNamespace } from '../mcp/proxy-names.js';
import {
  MEMORY_CORE_SECTION,
  MEMORY_INDEX_SECTION,
  MEMORY_POLICY_SECTION,
} from '../memory/session-memory.js';
import { SKILL_CATALOG_SECTION } from '../skills/session-catalog.js';
import { catalogSkillCount } from '../skills/skill-catalog.js';
import { readCarriedSkills } from '../skills/skill-message.js';
import { compactionPolicy } from './policy.js';

/** System prompt sections counted under memory rather than the system prompt. */
const MEMORY_SECTIONS: readonly string[] = [
  MEMORY_POLICY_SECTION,
  MEMORY_CORE_SECTION,
  MEMORY_INDEX_SECTION,
];
const MEMORY_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...MEMORY_READ_TOOLS,
  ...MEMORY_WRITE_TOOLS,
]);
/** `details` of a `memory_read` result (memory/tools.ts): the memory it read. */
const MemoryReadDetailsSchema = Type.Object({ id: Type.String(), name: Type.String() });

/** What a task's context breakdown is computed from. */
export interface ContextBreakdownInput {
  /** The task's model context; empty for a task without a session. */
  projection: Pick<SessionProjection, 'entries' | 'messages'>;
  /** The usage the context ring shows (`TaskContextState.tokens`); null when unknown. */
  tokens: number | null;
  contextWindow: number | null;
}

/**
 * Splits a task's context into the `ContextBreakdown` categories. The overhead categories are
 * estimated from the current system message (prompt sections and tool declarations) and the
 * entries that carry skills or memory; `messages` is the usage they leave. Without known usage,
 * the usage itself is the overhead plus an estimate of the rest of the conversation.
 */
export function contextBreakdown(input: ContextBreakdownInput): ContextBreakdown {
  const { projection, contextWindow } = input;
  const system = getCurrentSystemMessage(projection.messages);
  const tools = system?.toolsAdded ?? [];
  const mcpTools = tools.filter((tool) => mcpProxyNamespace(tool.name) !== null);
  const ownTools = tools.filter((tool) => mcpProxyNamespace(tool.name) === null);
  const sections = system?.sections ?? {};
  const skills = skillsCategory(projection, sections[SKILL_CATALOG_SECTION] ?? '');
  const memory = memoryCategory(projection, sections);
  const overhead: ContextBreakdownCategory[] = [
    { id: 'systemPrompt', tokens: promptTokens(system), count: null, items: [] },
    skills.category,
    memory.category,
    toolsCategory(ownTools),
    mcpCategory(mcpTools),
  ];
  // Skill messages and memory tool results are part of the conversation the estimate reads, but
  // counted under skills and memory.
  const conversation =
    projection.messages
      .filter((message) => message.role !== 'system')
      .reduce((total, message) => total + estimateTokens(message), 0) -
    skills.carried -
    memory.carried;
  const usedTokens = input.tokens ?? totalTokens(overhead) + Math.max(0, conversation);
  const fitted = fitToUsage(overhead, usedTokens);
  return {
    contextWindow,
    usedTokens,
    estimated: input.tokens === null,
    autocompactBuffer: contextWindow
      ? Math.min(
          compactionPolicy(contextWindow).reserveTokens,
          Math.max(0, contextWindow - usedTokens),
        )
      : 0,
    categories: [
      { id: 'messages', tokens: usedTokens - totalTokens(fitted), count: null, items: [] },
      ...fitted,
    ],
  };
}

/** Pi's estimate (`estimateTokens`): about four characters per token. */
function tokensOf(chars: number): number {
  return Math.ceil(chars / 4);
}

function totalTokens(categories: readonly { tokens: number }[]): number {
  return categories.reduce((total, category) => total + category.tokens, 0);
}

/** The system prompt's base text and every section but the skill catalog and the memory ones. */
function promptTokens(system: SystemMessage | undefined): number {
  if (!system) return 0;
  const content =
    typeof system.content === 'string'
      ? system.content.length
      : system.content.reduce((total, part) => total + part.text.length, 0);
  const sections = Object.entries(system.sections ?? {}).reduce(
    (total, [name, text]) =>
      name === SKILL_CATALOG_SECTION || MEMORY_SECTIONS.includes(name) || !text
        ? total
        : total + text.length,
    0,
  );
  return tokensOf(content + sections);
}

/** Tool declarations as Pi estimates them: their JSON. */
function toolTokens(tools: readonly Tool[]): number {
  return tools.length ? tokensOf(JSON.stringify(tools).length) : 0;
}

/**
 * The catalog section plus every entry in context that carries skills: `app-skill` messages and
 * `load_skill` results (skills/skill-message.ts `readCarriedSkills`). `carried` is those entries'
 * estimate, which the conversation estimate leaves out; an item is one skill name's blocks.
 */
function skillsCategory(
  projection: ContextBreakdownInput['projection'],
  catalog: string,
): { category: ContextBreakdownCategory; carried: number } {
  const blocks = new Map<string, number>();
  let carried = 0;
  for (const entry of projection.entries) {
    const skills = readCarriedSkills(entry.sourceEntry);
    if (!skills.length || !entry.messages.length) continue;
    carried += entry.messages.reduce((total, message) => total + estimateTokens(message), 0);
    for (const skill of skills)
      blocks.set(skill.name, (blocks.get(skill.name) ?? 0) + tokensOf(skill.block.length));
  }
  const items = largestFirst(
    [...blocks].map(([name, tokens]): ContextBreakdownItem => ({ name, tokens, count: null })),
  );
  return {
    category: {
      id: 'skills',
      tokens: tokensOf(catalog.length) + carried,
      count: catalogSkillCount(catalog) ?? items.length,
      items,
    },
    carried,
  };
}

/**
 * The memory sections plus every memory tool result in context. `carried` is those results'
 * estimate, which the conversation estimate leaves out; an item is one memory's `memory_read`
 * results, and the count is the memories the sections show, else the memories read.
 */
function memoryCategory(
  projection: ContextBreakdownInput['projection'],
  sections: Readonly<Record<string, string | null>>,
): { category: ContextBreakdownCategory; carried: number } {
  const reads = new Map<string, number>();
  let carried = 0;
  for (const entry of projection.entries) {
    const source = entry.sourceEntry;
    if (source.type !== 'message' || source.message.role !== 'toolResult') continue;
    if (!MEMORY_TOOL_NAMES.has(source.message.toolName) || !entry.messages.length) continue;
    const tokens = entry.messages.reduce((total, message) => total + estimateTokens(message), 0);
    carried += tokens;
    const { details, isError, toolName } = source.message;
    if (toolName === 'memory_read' && !isError && Value.Check(MemoryReadDetailsSchema, details))
      reads.set(details.name, (reads.get(details.name) ?? 0) + tokens);
  }
  const items = largestFirst(
    [...reads].map(([name, tokens]): ContextBreakdownItem => ({ name, tokens, count: null })),
  );
  const chars = MEMORY_SECTIONS.reduce((total, name) => total + (sections[name] ?? '').length, 0);
  return {
    category: {
      id: 'memory',
      tokens: tokensOf(chars) + carried,
      count: shownMemoryCount(sections) ?? items.length,
      items,
    },
    carried,
  };
}

/**
 * The memories the core and index sections show, as memory/run-memory.ts renders them: one
 * `<memory name=…>` line per core memory, and the index's totals line, exact even when entries
 * were left out. Null without either section.
 */
function shownMemoryCount(sections: Readonly<Record<string, string | null>>): number | null {
  const core = sections[MEMORY_CORE_SECTION] ?? '';
  const index = sections[MEMORY_INDEX_SECTION] ?? '';
  if (!core && !index) return null;
  const totals = /^(\d+) memor(?:y|ies) in the index\.$/m.exec(index);
  return (core.match(/^<memory name="/gm)?.length ?? 0) + Number(totals?.[1] ?? 0);
}

/** The service's own tools, one item per tool. */
function toolsCategory(tools: readonly Tool[]): ContextBreakdownCategory {
  const items = largestFirst(
    tools.map((tool): ContextBreakdownItem => ({
      name: tool.name,
      tokens: toolTokens([tool]),
      count: null,
    })),
  );
  return { id: 'systemTools', tokens: totalTokens(items), count: tools.length, items };
}

/**
 * One item per MCP server: its proxies share a tool namespace, which their names carry
 * (mcp/proxy-names.ts), so transcripts group alike whatever the tools' descriptions say. An item
 * is named by the namespace without `mcp__`: the server id as tool names spell it.
 */
function mcpCategory(tools: readonly Tool[]): ContextBreakdownCategory {
  const servers = new Map<string, Tool[]>();
  for (const tool of tools) {
    const server = (mcpProxyNamespace(tool.name) ?? tool.name).replace(/^mcp__/, '');
    servers.set(server, [...(servers.get(server) ?? []), tool]);
  }
  const items = largestFirst(
    [...servers].map(([name, group]): ContextBreakdownItem => ({
      name,
      tokens: toolTokens(group),
      count: group.length,
    })),
  );
  return { id: 'mcpTools', tokens: totalTokens(items), count: tools.length, items };
}

function largestFirst(items: ContextBreakdownItem[]): ContextBreakdownItem[] {
  return items.sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
}

/**
 * The overhead categories as they are when their estimate fits the usage; otherwise scaled down,
 * items included, so they sum to it exactly, the largest taking what rounding down left over.
 */
function fitToUsage(
  categories: ContextBreakdownCategory[],
  usedTokens: number,
): ContextBreakdownCategory[] {
  const total = totalTokens(categories);
  if (total <= usedTokens) return categories;
  const scale = (tokens: number) => Math.floor((tokens * usedTokens) / total);
  const scaled = categories.map((category) => ({
    ...category,
    tokens: scale(category.tokens),
    items: category.items.map((item) => ({ ...item, tokens: scale(item.tokens) })),
  }));
  const largest = scaled.reduce((max, category) => (category.tokens > max.tokens ? category : max));
  largest.tokens += usedTokens - totalTokens(scaled);
  return scaled;
}
