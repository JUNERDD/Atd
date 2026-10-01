import { getCurrentSystemMessage, type SystemMessage, type Tool } from '@earendil-works/pi-ai';
import { estimateTokens, type SessionProjection } from '@earendil-works/pi-coding-agent';
import type {
  ContextBreakdown,
  ContextBreakdownCategory,
  ContextBreakdownItem,
} from '@ai/agent-contracts';
import { mcpProxyServerId } from '../mcp/tool-proxies.js';
import { SKILL_CATALOG_SECTION } from '../skills/session-catalog.js';
import { catalogSkillCount } from '../skills/skill-catalog.js';
import { readCarriedSkills } from '../skills/skill-message.js';
import { compactionPolicy } from './policy.js';

/** What a task's context breakdown is computed from. */
export interface ContextBreakdownInput {
  /** The task's model context; empty for a task without a session. */
  projection: Pick<SessionProjection, 'entries' | 'messages'>;
  /** The usage the context ring shows (`TaskContextState.tokens`); null when unknown. */
  tokens: number | null;
  contextWindow: number | null;
}

/** Prefix of every MCP proxy tool (mcp/tool-proxies.ts `mcpProxyPrefix`). */
const MCP_TOOL_PREFIX = 'mcp__';

/**
 * Splits a task's context into the `ContextBreakdown` categories. The overhead categories are
 * estimated from the current system message (prompt sections and tool declarations) and the
 * entries that carry skills; `messages` is the usage they leave. Without known usage, the usage
 * itself is the overhead plus an estimate of the rest of the conversation.
 */
export function contextBreakdown(input: ContextBreakdownInput): ContextBreakdown {
  const { projection, contextWindow } = input;
  const system = getCurrentSystemMessage(projection.messages);
  const tools = system?.toolsAdded ?? [];
  const mcpTools = tools.filter((tool) => tool.name.startsWith(MCP_TOOL_PREFIX));
  const ownTools = tools.filter((tool) => !tool.name.startsWith(MCP_TOOL_PREFIX));
  const skills = skillsCategory(projection, system?.sections?.[SKILL_CATALOG_SECTION] ?? '');
  const overhead: ContextBreakdownCategory[] = [
    { id: 'systemPrompt', tokens: promptTokens(system), count: null, items: [] },
    skills.category,
    toolsCategory(ownTools),
    mcpCategory(mcpTools),
  ];
  // Skill messages are part of the conversation the estimate reads, but counted under skills.
  const conversation =
    projection.messages
      .filter((message) => message.role !== 'system')
      .reduce((total, message) => total + estimateTokens(message), 0) - skills.carried;
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

/** The system prompt's base text and every section but the skill catalog. */
function promptTokens(system: SystemMessage | undefined): number {
  if (!system) return 0;
  const content =
    typeof system.content === 'string'
      ? system.content.length
      : system.content.reduce((total, part) => total + part.text.length, 0);
  const sections = Object.entries(system.sections ?? {}).reduce(
    (total, [name, text]) =>
      name === SKILL_CATALOG_SECTION || !text ? total : total + text.length,
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

/** One item per MCP server, named by the server id its proxies declare. */
function mcpCategory(tools: readonly Tool[]): ContextBreakdownCategory {
  const servers = new Map<string, Tool[]>();
  for (const tool of tools) {
    const server = mcpProxyServerId(tool.description) ?? tool.name;
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
