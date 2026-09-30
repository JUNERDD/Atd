import { useTranslation } from 'react-i18next';
import type { PluginItem, PluginSummary } from '@ai/agent-contracts';
import { ExtensionAgentsGroup } from './extension-agents';
import { ExtensionCommandsGroup } from './extension-commands';
import { ExtensionMcpGroup } from './extension-mcp';
import type { ExtensionAgentRow } from './extension-rows';
import { ExtensionSkillsGroup } from './extension-skills';
import type { ExtensionBusyTarget } from './use-extension-mutations';
import type { ExtensionItemMatches } from './use-extension-matches';
import type { ExtensionItemKind } from './use-extension-route';
import type { PluginItemActions } from './use-plugin-item-actions';
import { usePluginLabels } from './use-plugin-labels';

/** The kinds listed as item rows, in the page's order. */
export type PluginGroupKind = 'command' | ExtensionItemKind;

/**
 * A plugin's contributions in the page's kind order: Commands, Skills, Subagents, MCP servers.
 * Empty kinds are left out. Plugin pages list every item; search results pass what matched and a
 * `titlePrefix` (the plugin's name) so each group says whose items it holds. While a toggleable
 * plugin is off, every item switch is locked with the reason in a tooltip. A plugin page passes
 * the plugin's `detailItems`, which name each item inside the plugin; search results resolve
 * those on demand.
 */
export function PluginItemGroups({
  plugin,
  titlePrefix = null,
  items,
  agentRows,
  connected,
  busy,
  mcpBusyId,
  mcpIssues,
  detailItems = null,
  only = null,
  actions,
  onOpen,
  onPatch,
}: {
  plugin: Pick<PluginSummary, 'id' | 'origin' | 'enabled' | 'toggleable' | 'name' | 'displayName'>;
  titlePrefix?: string | null;
  items: ExtensionItemMatches;
  /** Every catalog agent, for the permissions dialog. */
  agentRows: readonly ExtensionAgentRow[];
  connected: boolean;
  busy: ExtensionBusyTarget | null;
  /** The MCP server a connection step is running for. */
  mcpBusyId: string | null;
  /** Why each MCP server's last connection step failed, by server id. */
  mcpIssues: Readonly<Record<string, string>>;
  detailItems?: readonly PluginItem[] | null;
  /** One kind alone, as a plugin page's tab shows it; its tab names the kind, so no title. */
  only?: PluginGroupKind | null;
  actions: PluginItemActions;
  onOpen: (kind: ExtensionItemKind, name: string) => void;
  /** Shows a switch change on the open plugin page's detail as well. */
  onPatch?: (kind: PluginItem['kind'], name: string, enabled: boolean) => void;
}) {
  const { t } = useTranslation('settings');
  const labels = usePluginLabels();
  const lockedReason =
    plugin.toggleable && !plugin.enabled
      ? t('extensions.plugins.page.disabledByPlugin', { name: labels.name(plugin) })
      : null;
  const title = (kind: 'command' | ExtensionItemKind) => {
    const label = t(`extensions.plugins.kinds.${kind}`);
    return titlePrefix ? `${titlePrefix} · ${label}` : label;
  };
  const shows = (kind: PluginGroupKind) => only === null || only === kind;
  const showTitle = only === null;
  const itemOf = (kind: PluginItem['kind'], name: string) =>
    detailItems?.find((item) => item.kind === kind && item.name === name);
  const toggle = (kind: ExtensionItemKind, name: string, enabled: boolean) =>
    actions.setItemEnabled(
      {
        pluginId: plugin.id,
        origin: plugin.origin,
        kind,
        name,
        localName: itemOf(kind, name)?.localName ?? null,
      },
      enabled,
      onPatch ? (value) => onPatch(kind, name, value) : undefined,
    );
  const busyName = (kind: 'agent' | 'mcp') => (busy?.kind === kind ? busy.name : null);
  return (
    <>
      {shows('command') && items.commands.length ? (
        <ExtensionCommandsGroup
          title={title('command')}
          showTitle={showTitle}
          items={items.commands}
          connected={connected}
          lockedReason={lockedReason}
          onOpen={actions.openCommand}
          onEnabled={(row, enabled) =>
            actions.setServiceItemEnabled(
              {
                pluginId: plugin.id,
                kind: 'command',
                itemName: row.itemName,
                localName: itemOf('command', row.itemName)?.localName ?? null,
              },
              enabled,
              onPatch ? (value) => onPatch('command', row.itemName, value) : undefined,
            )
          }
        />
      ) : null}
      {shows('skill') && items.skills.length ? (
        <ExtensionSkillsGroup
          title={title('skill')}
          showTitle={showTitle}
          items={items.skills}
          loading={false}
          empty=""
          connected={connected}
          busyId={busy?.kind === 'builtin' || busy?.kind === 'skill' ? busy.name : null}
          lockedReason={lockedReason}
          onOpen={(name) => onOpen('skill', name)}
          onEnabled={(name, enabled) => toggle('skill', name, enabled)}
          onRestore={actions.restoreBuiltin}
          onDelete={actions.deleteSkill}
        />
      ) : null}
      {shows('agent') && items.agents.length ? (
        <ExtensionAgentsGroup
          title={title('agent')}
          showTitle={showTitle}
          rows={agentRows}
          items={items.agents}
          loading={false}
          empty=""
          connected={connected}
          busyId={busyName('agent')}
          lockedReason={lockedReason}
          onOpen={(name) => onOpen('agent', name)}
          onEnabled={(name, enabled) => toggle('agent', name, enabled)}
          onPermissions={actions.setAgentPermissions}
          onDelete={actions.deleteAgent}
        />
      ) : null}
      {shows('mcp') && items.mcp.length ? (
        <ExtensionMcpGroup
          title={title('mcp')}
          showTitle={showTitle}
          items={items.mcp}
          loading={false}
          empty=""
          connected={connected}
          busyId={mcpBusyId ?? busyName('mcp')}
          busy={busy?.kind === 'plugin' && busy.id === plugin.id}
          issues={mcpIssues}
          lockedReason={lockedReason}
          onOpen={(serverId) => onOpen('mcp', serverId)}
          onConnect={actions.mcpConnect}
          onAuthStart={actions.mcpAuthStart}
          onAuthComplete={actions.mcpAuthComplete}
          onRequestApproval={actions.mcpRequestApproval}
          onWithdrawApproval={actions.mcpWithdrawApproval}
          onEnabled={(serverId, enabled) => toggle('mcp', serverId, enabled)}
          onRemove={actions.removeServer}
        />
      ) : null}
    </>
  );
}
