import { Bot, MessageSquare, Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { rankByQuery } from '@ai/ui/lib/fuzzy-match';
import type { AgentTask } from '../../../electron/agent/task-schema';
import type { ComposerEditorCommands } from '../composer-editor/editor-commands';
import type { ExtensionAgentRow, ExtensionMcpRow } from '../service/extension-rows';
import { useMcpStateLabel } from '../service/use-mcp-state-label';
import { orderGroups, type QuickGroup, type QuickOption, type QuickView } from './quick-options';
import { relativeTime } from './relative-time';
import type { TriggerState } from './trigger';
import { useFileGroups } from './use-file-groups';
import type { ServiceListView } from './use-service-lists';

export type MentionTrigger = Extract<TriggerState, { kind: 'mention' }>;

/** Recent conversations for an empty query; a query searches further back. */
const CONVERSATIONS_RECENT = 5;
const CONVERSATIONS_MATCHES = 20;

/**
 * The `@` panel: files, conversations, MCP servers, and subagents. A pick inserts a chip; the
 * references themselves are derived from the chips when the draft is sent. Only conversations
 * with a session transcript can be referenced, and the current task is left out. A source with
 * nothing to offer takes no room; a query that leaves only "Browse files…" gets the empty line.
 */
export function useMentionView({
  trigger,
  open,
  editor,
  tasks,
  taskId,
  attachmentCount,
  agents,
  mcp,
}: {
  trigger: MentionTrigger | null;
  /** False while the panel animates out with its last rows. */
  open: boolean;
  editor: ComposerEditorCommands;
  tasks: readonly AgentTask[];
  taskId: string | null;
  attachmentCount: number;
  agents: ServiceListView<ExtensionAgentRow>;
  mcp: ServiceListView<ExtensionMcpRow>;
}): QuickView {
  const { t, i18n } = useTranslation('panel');
  const stateLabel = useMcpStateLabel();
  const query = trigger?.query ?? '';
  const files = useFileGroups({
    enabled: trigger !== null,
    live: open && trigger !== null,
    query,
    editor,
    tasks,
    attachmentCount,
  });
  if (!trigger || !files) return { groups: [], empty: null };
  const language = i18n.resolvedLanguage ?? i18n.language;

  const referable = tasks.filter((task) => task.id !== taskId && task.sessionFile !== null);
  const conversations: QuickGroup = {
    id: 'conversations',
    heading: t('quickPanel.groups.conversations'),
    options: rankByQuery(referable, query, (task) => ({ title: task.title }))
      .slice(0, query ? CONVERSATIONS_MATCHES : CONVERSATIONS_RECENT)
      .map(({ item: task, match }): QuickOption => ({
        value: `task:${task.id}`,
        score: match?.score,
        ranges: match?.ranges,
        icon: <MessageSquare />,
        title: task.title,
        status: relativeTime(Date.parse(task.updatedAt), language),
        // A title taken from a multi-line first message would break the one-line chip and its text.
        select: () =>
          editor.insertChips([
            { kind: 'task', taskId: task.id, title: task.title.replace(/\s+/g, ' ').trim() },
          ]),
      })),
  };

  const servers = mcp.status === 'ready' ? mcp.rows : [];
  const mcpGroup: QuickGroup = {
    id: 'mcp',
    heading: t('quickPanel.groups.mcp'),
    options: rankByQuery(servers, query, (row) => ({
      title: row.serverId,
      description: row.lastError,
    })).map(({ item: row, match }): QuickOption => ({
      value: `mcp:${row.serverId}`,
      score: match?.score,
      ranges: match?.ranges,
      icon: <Plug />,
      title: row.serverId,
      description: row.lastError || undefined,
      status: stateLabel(row.state),
      // A disabled server offers no tools to prefer, so it stays visible but cannot be picked.
      disabled: row.state === 'disabled',
      select: () => editor.insertChips([{ kind: 'mcpServer', serverId: row.serverId }]),
    })),
  };

  // An agent turned off in Settings would only be refused at send, so it is not offered.
  const catalog = agents.status === 'ready' ? agents.rows.filter((row) => row.enabled) : [];
  const agentGroup: QuickGroup = {
    id: 'agents',
    heading: t('quickPanel.groups.agents'),
    options: rankByQuery(catalog, query, (row) => ({
      title: row.name,
      description: row.description,
    })).map(({ item: row, match }): QuickOption => ({
      value: `agent:${row.name}`,
      score: match?.score,
      ranges: match?.ranges,
      icon: <Bot />,
      title: row.name,
      description: row.description || undefined,
      select: () => editor.insertChips([{ kind: 'agent', name: row.name }]),
    })),
  };

  // A source still answering may yet match, so it is not reported as no match.
  const loading = files.loading || mcp.status === 'loading' || agents.status === 'loading';
  return {
    // "Browse files…" ends the list, so the first candidate, not the picker, is active by default.
    groups: orderGroups([...files.lists, conversations, mcpGroup, agentGroup, files.browse], query),
    empty: !query
      ? null
      : loading
        ? t('quickPanel.states.loading')
        : t('quickPanel.states.noMatches'),
  };
}
