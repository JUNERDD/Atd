import { useTranslation } from 'react-i18next';
import { showToast } from '../../components/toast-store';
import { AgentPage } from './extension-agent-page';
import { McpPage } from './extension-mcp-page';
import { SkillDetailPage } from './extension-skill-detail-page';
import { messageOf } from '../../lib/errors';
import { showErrorToast } from '../../components/toast-store';
import { USER_PLUGIN_ID } from './plugin-rows';
import { findPluginItem } from './use-plugin-detail';
import type { Extensions } from './use-extensions';
import type { ExtensionItemKind, ExtensionRoute } from './use-extension-route';
import { usePluginLabels } from './use-plugin-labels';

/**
 * The item pages of Extensions: one skill, subagent or MCP server of a plugin, and the add forms
 * that create a Personal subagent or MCP server. Cancel steps back (`onBack`), asking first about
 * unsaved changes; a save on a form, or deleting a Personal item, leaves the page once it
 * succeeds (`onLeave`, never asked); a failure keeps it for repair. Duplicate to Personal copies a
 * read-only item and opens its Personal copy, with Personal's page behind it, once the catalogs
 * list it.
 */
export function ExtensionItemRoute({
  route,
  extensions,
  onBack,
  onLeave,
  onOpenItem,
  onStartAi,
}: {
  route: Extract<ExtensionRoute, { level: 'item' | 'create' }>;
  extensions: Extensions;
  /** Cancel: the page history's guarded Back. */
  onBack: () => void;
  /** Leaves after a save or delete succeeds, without asking about unsaved changes. */
  onLeave: () => void;
  /** Shows another item with its plugin's page behind it, as Duplicate does with the copy. */
  onOpenItem: (item: { pluginId: string; kind: ExtensionItemKind; name: string }) => void;
  onStartAi: (kind: ExtensionItemKind, target: string | null) => void;
}) {
  const { t } = useTranslation('settings');
  const labels = usePluginLabels();
  const { connected, busy, skills, agents, mcp, mutations, pluginMutations } = extensions;
  const pluginId = route.level === 'item' ? route.pluginId : USER_PLUGIN_ID;
  const plugin = extensions.plugins.plugins?.find((entry) => entry.id === pluginId);
  const pluginName = plugin ? labels.name(plugin) : pluginId;
  const backLabel =
    route.level === 'item'
      ? t('extensions.plugins.page.backToPlugin', { name: pluginName })
      : t('extensions.plugins.page.back');
  const locked = busy !== null;
  const agentRows = agents.agents?.agents ?? [];
  const mcpRows = mcp.mcp?.servers ?? [];

  /** Leaves the form once its save succeeds; a failure keeps the draft for repair. */
  async function saved(save: Promise<boolean>, text: string) {
    const ok = await save;
    if (!ok) return false;
    onLeave();
    showToast({ kind: 'info', text });
    return true;
  }
  /** Leaves the page once the item is gone; a failure keeps it, with the error in a toast. */
  async function removed(remove: Promise<boolean>, text: string) {
    if (!(await remove)) return;
    onLeave();
    showToast({ kind: 'info', text });
  }
  async function duplicate(kind: ExtensionItemKind, name: string) {
    let localName: string;
    try {
      localName = (await findPluginItem(pluginId, kind, name)).localName;
    } catch (error) {
      showErrorToast(messageOf(error));
      return;
    }
    const copy = await pluginMutations.duplicate({ id: pluginId, kind, name: localName });
    if (!copy) return;
    await Promise.all([skills.refresh(), agents.refresh(), mcp.refresh()]);
    extensions.refreshAll();
    showToast({ kind: 'info', text: t('extensions.plugins.item.duplicated', { name: copy.name }) });
    // An MCP copy leaves out the env vars and headers its plugin filled from secrets.
    if (copy.omitted.length)
      showToast({
        kind: 'warning',
        text: t('extensions.plugins.item.secretsNotCopied', { names: copy.omitted.join(', ') }),
      });
    if (copy.kind === 'skill' || copy.kind === 'agent' || copy.kind === 'mcp')
      onOpenItem({ pluginId: USER_PLUGIN_ID, kind: copy.kind, name: copy.name });
  }

  const kind = route.kind;
  const name = route.level === 'item' ? route.name : null;
  switch (kind) {
    case 'skill':
      return (
        <SkillDetailPage
          key={name}
          name={name ?? ''}
          rows={skills.skills?.skills ?? []}
          pluginName={pluginName}
          connected={connected}
          busy={locked}
          onStartAi={() => onStartAi('skill', name)}
          onDuplicate={() => void duplicate('skill', name ?? '')}
          onDelete={() =>
            void removed(
              mutations.deleteSkill(name ?? '', skills.refresh),
              t('extensions.deleted', { name }),
            )
          }
        />
      );
    case 'agent':
      return (
        <AgentPage
          key={name ?? ''}
          name={name}
          rows={agentRows}
          pluginName={pluginName}
          backLabel={backLabel}
          connected={connected}
          busy={locked}
          onBack={onBack}
          onSave={(input) =>
            saved(mutations.putAgent(input, agents.refresh), t('extensions.subagentSaved'))
          }
          onPermissions={(agent, value) =>
            mutations.setAgentPermissions(agent, value, agents.refresh)
          }
          onStartAi={(target) => onStartAi('agent', target)}
          onDuplicate={() => void duplicate('agent', name ?? '')}
          onDelete={() =>
            void removed(
              mutations.deleteAgent(name ?? '', agents.refresh),
              t('extensions.deleted', { name }),
            )
          }
        />
      );
    case 'mcp':
      return (
        <McpPage
          key={name ?? ''}
          serverId={name}
          rows={mcpRows}
          backLabel={backLabel}
          connected={connected}
          busy={locked || (name !== null && mcp.busyId === name)}
          issue={name === null ? null : (mcp.issues[name] ?? null)}
          onBack={onBack}
          onUpsert={(input) =>
            saved(mutations.mcpUpsert(input, mcp.refresh), t('extensions.serverSaved'))
          }
          onConnect={(serverId) => void mcp.connect(serverId)}
          onAuthStart={(serverId) => void mcp.authStart(serverId)}
          onRequestApproval={(serverId) => void mcp.requestApproval(serverId)}
          onWithdrawApproval={(serverId) => void mcp.withdrawApproval(serverId)}
          onStartAi={(target) => onStartAi('mcp', target)}
          onDuplicate={() => void duplicate('mcp', name ?? '')}
          onRemove={() =>
            void removed(
              mutations.mcpRemove(name ?? '', mcp.refresh),
              t('extensions.removed', { name }),
            )
          }
        />
      );
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
