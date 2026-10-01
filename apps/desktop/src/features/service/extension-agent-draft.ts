import { ROLE_TOOLS, type ExtensionAgentRow, type ExtensionRoleTool } from './extension-rows';

/**
 * The subagent form's editable state and the checks it runs before a save. The limits mirror
 * `putAtdAgent` (apps/agent-service/src/atd-agents/catalog.ts), which trims every value and
 * overwrites `~/.atd/agents/<name>.md`, so one save path serves both create and edit.
 */
export interface AgentDraft {
  name: string;
  description: string;
  /** In ROLE_TOOLS order; an empty list lets the subagent use the task's tools. */
  tools: ExtensionRoleTool[];
  model: string;
  systemPrompt: string;
}

/** What the service writes; `model` null leaves it out of the file. */
export interface AgentInput {
  name: string;
  description: string;
  tools: ExtensionRoleTool[];
  model: string | null;
  systemPrompt: string;
}

export const AGENT_LIMITS = {
  name: 128,
  description: 2048,
  model: 256,
  systemPrompt: 16000,
} as const;

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Fields a save can reject, in the order the form shows them (the first one gets focus). */
export const AGENT_CHECKED_FIELDS = ['name', 'description', 'systemPrompt'] as const;
export type AgentCheckedField = (typeof AGENT_CHECKED_FIELDS)[number];

/** Suffixes of the `extensions.agentPage.errors.*` messages. */
export type AgentDraftError =
  | 'nameRequired'
  | 'namePattern'
  | 'nameTaken'
  | 'descriptionRequired'
  | 'systemPromptRequired';

export type AgentDraftErrors = Partial<Record<AgentCheckedField, AgentDraftError>>;

export const EMPTY_AGENT_DRAFT: AgentDraft = {
  name: '',
  description: '',
  tools: [],
  model: '',
  systemPrompt: '',
};

/**
 * A markdown agent's file as a draft. Its tools come from `defaults`, the file's own list, not
 * from `permissions`, which a Settings override may have replaced.
 */
export function agentDraftOf(row: ExtensionAgentRow): AgentDraft {
  return {
    name: row.name,
    description: row.description,
    tools: ROLE_TOOLS.filter((tool) => row.defaults.tools?.includes(tool)),
    model: row.model,
    systemPrompt: row.systemPrompt,
  };
}

/** Whether two drafts hold the same values, as an unchanged form does. */
export function sameAgentDraft(a: AgentDraft, b: AgentDraft): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.model === b.model &&
    a.systemPrompt === b.systemPrompt &&
    a.tools.length === b.tools.length &&
    a.tools.every((tool, index) => tool === b.tools[index])
  );
}

/** Turns one tool on or off, keeping the list in ROLE_TOOLS order. */
export function withAgentTool(draft: AgentDraft, tool: ExtensionRoleTool, on: boolean): AgentDraft {
  return {
    ...draft,
    tools: ROLE_TOOLS.filter((value) => (value === tool ? on : draft.tools.includes(value))),
  };
}

/**
 * The draft's problems. `takenNames` holds the catalog names a new agent must not reuse; it is
 * null when editing, where the name is fixed. The comparison ignores case because the file name
 * is the agent name and a case-insensitive disk would let `Reviewer.md` replace `reviewer.md`.
 * Lengths are capped by the inputs' `maxLength`, so only empty and malformed values remain.
 */
export function agentDraftErrors(
  draft: AgentDraft,
  takenNames: readonly string[] | null,
): AgentDraftErrors {
  const errors: AgentDraftErrors = {};
  if (takenNames) {
    const name = draft.name.trim();
    const lower = name.toLowerCase();
    if (!name) errors.name = 'nameRequired';
    else if (!NAME_PATTERN.test(name)) errors.name = 'namePattern';
    else if (takenNames.some((taken) => taken.toLowerCase() === lower)) errors.name = 'nameTaken';
  }
  if (!draft.description.trim()) errors.description = 'descriptionRequired';
  if (!draft.systemPrompt.trim()) errors.systemPrompt = 'systemPromptRequired';
  return errors;
}

export function agentInputOf(draft: AgentDraft): AgentInput {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    tools: draft.tools,
    model: draft.model.trim() || null,
    systemPrompt: draft.systemPrompt.trim(),
  };
}
