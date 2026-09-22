/**
 * T5 runtime agents. The service registers three foreground-only agents per
 * parent session; packaged agent names stay refused by the ceiling. Tools are
 * omitted so the service ceiling (parent ∩ role ∩ revocation) decides; the
 * agents pin context, async default, depth and extension isolation instead.
 */

export interface RuntimeAgentDefinition {
  description: string;
  systemPrompt: string;
  extensions: readonly string[];
  inheritProjectContext: boolean;
  inheritGlobalContext: boolean;
  inheritSkills: boolean;
  defaultContext: 'fresh';
  defaultAsync: boolean;
  maxSubagentDepth: number;
  thinking: string;
}

export const SERVICE_RUNTIME_AGENTS: { name: string; definition: RuntimeAgentDefinition }[] = [
  {
    name: 'service.worker',
    definition: {
      description: 'Bounded implementation child for one foreground task.',
      systemPrompt:
        'You are the service worker child. Implement only the assigned task with the available tools. Keep edits minimal and report what changed.',
      extensions: [],
      inheritProjectContext: false,
      inheritGlobalContext: false,
      inheritSkills: false,
      defaultContext: 'fresh',
      defaultAsync: false,
      maxSubagentDepth: 1,
      thinking: 'off',
    },
  },
  {
    name: 'service.reviewer',
    definition: {
      description: 'Read-only review child returning findings with evidence.',
      systemPrompt:
        'You are the service reviewer child. Inspect only the assigned material and return findings with file and line evidence. Do not mutate files.',
      extensions: [],
      inheritProjectContext: false,
      inheritGlobalContext: false,
      inheritSkills: false,
      defaultContext: 'fresh',
      defaultAsync: false,
      maxSubagentDepth: 1,
      thinking: 'off',
    },
  },
  {
    name: 'service.scout',
    definition: {
      description: 'Read-only discovery child mapping code behavior.',
      systemPrompt:
        'You are the service scout child. Map only the requested behavior and return paths, symbols and brief notes. Do not mutate files.',
      extensions: [],
      inheritProjectContext: false,
      inheritGlobalContext: false,
      inheritSkills: false,
      defaultContext: 'fresh',
      defaultAsync: false,
      maxSubagentDepth: 1,
      thinking: 'off',
    },
  },
];

export function serviceAgentNames(): string[] {
  return SERVICE_RUNTIME_AGENTS.map((agent) => agent.name);
}

/** Registers the three service agents on one parent ExtensionAPI. */
export function registerServiceAgents(
  pi: unknown,
  register: (input: { pi: unknown; name: string; definition: RuntimeAgentDefinition }) => {
    dispose(): void;
  },
): { dispose(): void } {
  const handles = SERVICE_RUNTIME_AGENTS.map((agent) =>
    register({ pi, name: agent.name, definition: agent.definition }),
  );
  return {
    dispose: () => {
      for (const handle of handles) handle.dispose();
    },
  };
}
