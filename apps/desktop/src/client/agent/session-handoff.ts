import { Type, type Static } from 'typebox';
import { AutomationDraftSchema, Identifier } from '@atd/agent-contracts';
import { parse } from './validation';

/*
 * Hand-offs that open a new panel session seeded for an editor in another window: the settings
 * window asks for the session, and the panel receives it through the agent bridge's session
 * listeners (`AgentBridge.onCommandSession` and the others).
 */

/** Hands the command editor off to a new panel session; a null id means "create a command". */
export interface CommandSession {
  commandId: string | null;
  name: string;
}

/**
 * Hands the automation editor off to a new panel session: the saved automation an edit session
 * updates, which the seeded prompt names by name and id, or null to create one. It is validated
 * where it crosses between windows.
 */
export const AutomationSessionTargetSchema = Type.Union([
  Type.Object(
    { id: Identifier, name: AutomationDraftSchema.properties.name },
    { additionalProperties: false },
  ),
  Type.Null(),
]);
export type AutomationSessionTarget = Static<typeof AutomationSessionTargetSchema>;

/**
 * Hands create- or edit-with-AI off to a new panel session seeded with an app skill: Extensions
 * creates or edits a skill, subagent, or MCP server; Memory saves or updates a memory.
 */
export const ExtensionSessionKindSchema = Type.Union([
  Type.Literal('skill'),
  Type.Literal('subagent'),
  Type.Literal('mcp'),
  Type.Literal('memory'),
]);
export type ExtensionSessionKind = Static<typeof ExtensionSessionKindSchema>;
/**
 * The existing item an edit session updates: a skill or subagent name, or an MCP serverId. It is
 * quoted into the seeded prompt, so it must be one trimmed line. Null starts a create session.
 */
export const ExtensionSessionTargetSchema = Type.Union([
  Type.String({ minLength: 1, maxLength: 128, pattern: '^\\S(?:.*\\S)?$' }),
  Type.Null(),
]);
export interface ExtensionSession {
  kind: ExtensionSessionKind;
  target: string | null;
}

/**
 * Validates an extension session request at a process or tab boundary. Memory has no edit target
 * (its skill saves or updates memories from the conversation), so a memory target is rejected
 * rather than silently dropped.
 */
export function parseExtensionSession(kind: unknown, target: unknown): ExtensionSession {
  const session = {
    kind: parse(ExtensionSessionKindSchema, kind),
    target: parse(ExtensionSessionTargetSchema, target),
  };
  if (session.kind === 'memory' && session.target !== null)
    throw new TypeError('Memory sessions do not take an edit target');
  return session;
}
