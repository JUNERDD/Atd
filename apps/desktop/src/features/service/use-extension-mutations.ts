import { useMemo } from 'react';
import { mutationOptions, useMutation } from '@tanstack/react-query';
import type { SubagentPermissions } from '@atd/agent-contracts';
import type { McpUpsertInput } from '../../client/service/ipc';
import { queryClient } from '../../lib/query-client';
import type { ExtensionRoleTool } from './extension-rows';
import { extensionWrite, serviceApi, SWITCH_KEY } from './extension-writes';
import { serviceListKeys } from './use-service';

export type { ExtensionBusyTarget } from './extension-writes';

const setSkillEnabled = mutationOptions({
  mutationKey: [SWITCH_KEY, 'skill'],
  mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
    serviceApi().setSkillEnabled(name, enabled),
});
const setAgentEnabled = mutationOptions({
  mutationKey: [SWITCH_KEY, 'agent'],
  mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
    serviceApi().setAgentEnabled(name, enabled),
});
const deleteSkill = extensionWrite(
  'skill',
  ({ name }: { name: string }) => serviceApi().deleteSkill(name),
  { reload: serviceListKeys.skills },
);
const deleteAgent = extensionWrite(
  'agent',
  ({ name }: { name: string }) => serviceApi().deleteAgent(name),
  { reload: serviceListKeys.agents },
);
// A failed restore says nothing here: the row keeps its state and the caller reports it.
const restoreBuiltin = extensionWrite(
  'builtin',
  ({ id }: { id: string }) => serviceApi().restoreBuiltin(id),
  { reload: serviceListKeys.skills, quiet: true },
);
const putRole = extensionWrite(
  'role',
  (input: {
    id: string;
    title: string;
    allows: { tools: ExtensionRoleTool[]; skills: string[] };
  }) => serviceApi().putRole(input),
  { reload: serviceListKeys.roles },
);
const putAgent = extensionWrite(
  'agent',
  (input: {
    name: string;
    description: string;
    tools: ExtensionRoleTool[];
    model: string | null;
    systemPrompt: string;
  }) => serviceApi().putAgent(input),
  { reload: serviceListKeys.agents },
);
const setAgentPermissions = extensionWrite(
  'agent',
  ({ name, permissions }: { name: string; permissions: SubagentPermissions | null }) =>
    serviceApi().setAgentPermissions(name, permissions),
  { reload: serviceListKeys.agents },
);
const mcpUpsert = extensionWrite('mcp', (input: McpUpsertInput) => serviceApi().mcpUpsert(input), {
  reload: serviceListKeys.mcp,
});
const mcpSetEnabled = extensionWrite(
  'mcp',
  ({ serverId, enabled }: { serverId: string; enabled: boolean }) =>
    serviceApi().mcpSetEnabled(serverId, enabled),
  { reload: serviceListKeys.mcp },
);
const mcpRemove = extensionWrite(
  'mcp',
  ({ serverId }: { serverId: string }) => serviceApi().mcpRemove(serverId),
  { reload: serviceListKeys.mcp },
);

const succeeded = () => true;
const failed = () => false;

/**
 * Skill, subagent, role and MCP catalog writes. A failure shows its error toast; each write that
 * changes a list reloads it before it resolves. Switches reject after the toast, so a switch can
 * revert; the other writes resolve to whether they succeeded.
 */
export function useExtensionMutations() {
  const skillSwitch = useMutation(setSkillEnabled, queryClient).mutateAsync;
  const agentSwitch = useMutation(setAgentEnabled, queryClient).mutateAsync;
  const removeSkill = useMutation(deleteSkill, queryClient).mutateAsync;
  const removeAgent = useMutation(deleteAgent, queryClient).mutateAsync;
  const restore = useMutation(restoreBuiltin, queryClient).mutateAsync;
  const saveRole = useMutation(putRole, queryClient).mutateAsync;
  const saveAgent = useMutation(putAgent, queryClient).mutateAsync;
  const savePermissions = useMutation(setAgentPermissions, queryClient).mutateAsync;
  const saveServer = useMutation(mcpUpsert, queryClient).mutateAsync;
  const serverSwitch = useMutation(mcpSetEnabled, queryClient).mutateAsync;
  const removeServer = useMutation(mcpRemove, queryClient).mutateAsync;
  // Each `mutateAsync` is stable, so the writes are too: pages may run them from effects.
  return useMemo(
    () => ({
      setSkillEnabled: (name: string, enabled: boolean) => skillSwitch({ name, enabled }),
      setAgentEnabled: (name: string, enabled: boolean) => agentSwitch({ name, enabled }),
      /** Deletes a Personal skill's files; resolves to whether it was deleted. */
      deleteSkill: (name: string) => removeSkill({ name }).then(succeeded, failed),
      /** Deletes a Personal subagent's file and its settings; resolves to whether it was deleted. */
      deleteAgent: (name: string) => removeAgent({ name }).then(succeeded, failed),
      /**
       * Reinstalls the shipped version of a built-in resource after the service backs up the user's
       * copy; the builtin id (`skill:<name>` for skill rows) is busy meanwhile. Resolves to the
       * backup path (null when there was nothing to back up), or undefined when the restore failed.
       */
      restoreBuiltin: (id: string) =>
        restore({ id }).then(
          (result) => ({ backupPath: result.backupPath }),
          () => undefined,
        ),
      putRole: (input: Parameters<typeof saveRole>[0]) => saveRole(input).then(succeeded, failed),
      putAgent: (input: Parameters<typeof saveAgent>[0]) =>
        saveAgent(input).then(succeeded, failed),
      /** Saves one subagent's permissions for later runs, or with null restores its defaults. */
      setAgentPermissions: (name: string, permissions: SubagentPermissions | null) =>
        savePermissions({ name, permissions }).then(succeeded, failed),
      mcpUpsert: (input: Parameters<typeof saveServer>[0]) =>
        saveServer(input).then(succeeded, failed),
      /** Turns a Personal server on or off; rejects after showing the error, so a switch can revert. */
      mcpSetEnabled: (serverId: string, enabled: boolean) =>
        serverSwitch({ serverId, enabled }).then(() => undefined),
      /** Removes a Personal server from the catalog; resolves to whether it was removed. */
      mcpRemove: (serverId: string) => removeServer({ serverId }).then(succeeded, failed),
    }),
    [
      agentSwitch,
      removeAgent,
      removeServer,
      removeSkill,
      restore,
      saveAgent,
      savePermissions,
      saveRole,
      saveServer,
      serverSwitch,
      skillSwitch,
    ],
  );
}
