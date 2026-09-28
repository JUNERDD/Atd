import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@ai/ui/components/input';
import { useCompositionQuery } from '@ai/ui/lib/ime';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ai/ui/components/tabs';
import { showToast } from '../../components/toast-store';
import { SettingsHeading } from '../settings/settings-heading';
import { useSettingsSectionExit } from '../settings/settings-navigation';
import { ExtensionAddButton, type ExtensionTab } from './extension-add-button';
import { AgentPage } from './extension-agent-page';
import { ExtensionAgentsGroup } from './extension-agents';
import { ExtensionGroup } from './extension-group';
import { ExtensionMcpGroup } from './extension-mcp';
import { McpPage } from './extension-mcp-page';
import { SkillPage } from './extension-skill-page';
import { ExtensionSkillsGroup } from './extension-skills';
import { useExtensionAiSession } from './use-extension-ai-session';
import { useExtensionMatches } from './use-extension-matches';
import { useExtensionMutations } from './use-extension-mutations';
import { useServiceAgents, useServiceMcp, useServiceSkills, useServiceStatus } from './use-service';

/** Which sub-page replaces the overview: a tab's add page (`name` null) or one item's details. */
type ExtensionPageRoute = { tab: ExtensionTab; name: string | null };

/**
 * Skills/subagents/MCP overview for the Extensions settings page. Adding an item and one item's
 * details open as sub-pages in place of the overview, as the command editor does; a successful
 * save returns to the list.
 */
export function ServiceSettings() {
  const { t } = useTranslation('settings');
  const search = useCompositionQuery();
  const query = search.query;
  const [tab, setTab] = useState<ExtensionTab>('skills');
  const [page, setPage] = useState<ExtensionPageRoute | null>(null);
  useSettingsSectionExit(() => {
    setPage(null);
    setTab('skills');
    search.change('');
  });
  const { status } = useServiceStatus();
  const { skills, loading: skillsLoading, refresh: refreshSkills, setEnabled } = useServiceSkills();
  const {
    agents,
    loading: agentsLoading,
    refresh: refreshAgents,
    setEnabled: setAgentRowEnabled,
  } = useServiceAgents();
  const {
    mcp,
    loading: mcpLoading,
    busyId,
    refresh: refreshMcp,
    connect: mcpConnect,
    authStart,
    authComplete,
  } = useServiceMcp();
  const {
    busyKey,
    setSkillEnabled,
    setAgentEnabled,
    updateSkill,
    restoreBuiltin,
    installSkill,
    putAgent,
    setAgentPermissions,
    mcpUpsert,
    mcpSetEnabled,
    mcpRemove,
  } = useExtensionMutations();
  const connected = status?.state === 'connected';
  const catalogBusy = busyKey !== null;
  const menuDisabled = !connected || catalogBusy;
  const enableSeq = useRef(new Map<string, number>());
  /**
   * Shows a switch change at once and reverts it when the write fails, unless a later change to
   * the same row already superseded it.
   */
  function toggleOptimistically(
    key: string,
    enabled: boolean,
    show: (enabled: boolean) => void,
    save: (enabled: boolean) => Promise<void>,
  ) {
    const seq = (enableSeq.current.get(key) ?? 0) + 1;
    enableSeq.current.set(key, seq);
    show(enabled);
    void save(enabled).catch(() => {
      if (enableSeq.current.get(key) === seq) show(!enabled);
    });
  }
  useEffect(() => {
    if (!connected) return;
    const refresh = () => {
      void refreshSkills();
      void refreshAgents();
      void refreshMcp();
    };
    refresh();
    // Another client (the desktop app or a browser) changed the extensions.
    return window.desktop?.service?.onChange((event) => {
      if (event.type === 'extensions') refresh();
    });
  }, [connected, refreshAgents, refreshMcp, refreshSkills]);
  const catalogCount =
    (skills?.skills.length ?? 0) + (agents?.agents.length ?? 0) + (mcp?.servers.length ?? 0);
  const searching = Boolean(query.trim());
  const matches = useExtensionMatches(query, {
    skills: skills?.skills ?? [],
    agents: agents?.agents ?? [],
    mcp: mcp?.servers ?? [],
  });
  const skillBusyName =
    busyKey?.startsWith('skill:') && busyKey !== 'skill:install'
      ? busyKey.slice('skill:'.length)
      : null;
  const agentsBusy = busyKey?.startsWith('agent:') ?? false;
  const mcpBusy = busyKey?.startsWith('mcp:') ?? false;

  const startAi = useExtensionAiSession(skills?.skills ?? []);
  /** Returns to the list once a page's save succeeds; a failure keeps the page for repair. */
  async function saved(save: Promise<boolean>, text: string) {
    const ok = await save;
    if (!ok) return false;
    setPage(null);
    showToast({ kind: 'info', text });
    return true;
  }

  if (page) {
    const back = () => setPage(null);
    const onStartAi = (target: string | null) => void startAi(page.tab, target);
    switch (page.tab) {
      case 'skills':
        return (
          <SkillPage
            name={page.name}
            rows={skills?.skills ?? []}
            connected={connected}
            busy={catalogBusy}
            onBack={back}
            onInstall={(input) =>
              saved(installSkill(input, refreshSkills), t('extensions.skillInstalled'))
            }
            onStartAi={onStartAi}
          />
        );
      case 'subagents':
        return (
          <AgentPage
            name={page.name}
            rows={agents?.agents ?? []}
            connected={connected}
            busy={catalogBusy}
            onBack={back}
            onSave={(input) => saved(putAgent(input, refreshAgents), t('extensions.subagentSaved'))}
            onPermissions={(name, value) => setAgentPermissions(name, value, refreshAgents)}
            onStartAi={onStartAi}
          />
        );
      case 'mcp':
        return (
          <McpPage
            serverId={page.name}
            rows={mcp?.servers ?? []}
            connected={connected}
            busy={catalogBusy || (page.name !== null && busyId === page.name)}
            onBack={back}
            onUpsert={(input) => saved(mcpUpsert(input, refreshMcp), t('extensions.serverSaved'))}
            onConnect={(serverId) => void mcpConnect(serverId)}
            onAuthStart={(serverId) => void authStart(serverId)}
            onStartAi={onStartAi}
          />
        );
      default: {
        const _exhaustive: never = page.tab;
        return _exhaustive;
      }
    }
  }

  const skillsGroup = (
    <ExtensionSkillsGroup
      items={matches.skills}
      showTitle={searching}
      // Subagent and MCP rows always show More, so listed below them skills keep its column.
      reserveMenu={searching && matches.agents.length + matches.mcp.length > 0}
      loading={skillsLoading}
      empty={t('service.emptySkills')}
      connected={connected}
      busyName={skillBusyName}
      onOpen={(name) => setPage({ tab: 'skills', name })}
      onEnabled={(name, enabled) =>
        toggleOptimistically(
          `skill:${name}`,
          enabled,
          (value) => setEnabled(name, value),
          (value) => setSkillEnabled(name, value),
        )
      }
      onUpdate={(name) => void updateSkill(name, refreshSkills)}
      onRestore={(id) => restoreBuiltin(id, refreshSkills)}
    />
  );
  const agentsGroup = (
    <ExtensionAgentsGroup
      rows={agents?.agents ?? []}
      items={matches.agents}
      showTitle={searching}
      loading={agentsLoading}
      empty={t('service.emptyAgents')}
      connected={connected}
      busy={agentsBusy}
      onOpen={(name) => setPage({ tab: 'subagents', name })}
      onEnabled={(name, enabled) =>
        toggleOptimistically(
          `agent:${name}`,
          enabled,
          (value) => setAgentRowEnabled(name, value),
          (value) => setAgentEnabled(name, value),
        )
      }
      onPermissions={(name, value) => setAgentPermissions(name, value, refreshAgents)}
    />
  );
  const mcpGroup = (
    <ExtensionMcpGroup
      items={matches.mcp}
      showTitle={searching}
      loading={mcpLoading}
      empty={t('service.emptyMcp')}
      connected={connected}
      busyId={busyId}
      busy={mcpBusy}
      onOpen={(serverId) => setPage({ tab: 'mcp', name: serverId })}
      onConnect={(serverId) => void mcpConnect(serverId)}
      onAuthStart={(serverId) => void authStart(serverId)}
      onAuthComplete={(serverId, input) => void authComplete(serverId, input)}
      onEnabled={(serverId, enabled) => void mcpSetEnabled(serverId, enabled, refreshMcp)}
      onRemove={(serverId) => void mcpRemove(serverId, refreshMcp)}
    />
  );
  const matchCount = matches.skills.length + matches.agents.length + matches.mcp.length;
  // The panel owns the scrollbar; the heading, search, and tab row stay put above it.
  const scroll = (content: ReactNode) => (
    <ScrollArea
      className="flex-1"
      viewportClassName="[&>div]:flex! [&>div]:flex-col [&>div]:min-h-full"
      gutter="stable"
      scrollShadow
    >
      {content}
    </ScrollArea>
  );

  return (
    <section className="settings-extension-settings" aria-label={t('extensions.title')}>
      <SettingsHeading title={t('extensions.title')} description={t('extensions.description')}>
        <Input
          aria-label={t('extensions.searchLabel')}
          placeholder={t('extensions.searchPlaceholder')}
          value={search.text}
          disabled={!catalogCount}
          onChange={(event) => search.change(event.target.value)}
          {...search.compositionProps}
        />
      </SettingsHeading>
      <div className="settings-extension-tabs">
        {searching ? (
          // A search spans all three catalogs: the tabs and the add button step aside, and only
          // the groups with a match stay, each under its own title.
          scroll(
            matchCount ? (
              <div className="settings-extension-results">
                {matches.skills.length ? skillsGroup : null}
                {matches.agents.length ? agentsGroup : null}
                {matches.mcp.length ? mcpGroup : null}
              </div>
            ) : (
              <ExtensionGroup
                title={t('extensions.title')}
                empty={t('extensions.noMatches')}
                loading={skillsLoading || agentsLoading || mcpLoading}
                hasRows={false}
                showTitle={false}
                emptyIcon={<Search />}
              />
            ),
          )
        ) : (
          <Tabs
            value={tab}
            onValueChange={(value) => {
              if (value !== 'skills' && value !== 'subagents' && value !== 'mcp') return;
              setTab(value);
            }}
          >
            <div className="settings-extension-tab-row">
              <TabsList aria-label={t('extensions.tabsLabel')}>
                <TabsTrigger value="skills">{t('extensions.tabSkills')}</TabsTrigger>
                <TabsTrigger value="subagents">{t('extensions.tabSubagents')}</TabsTrigger>
                <TabsTrigger value="mcp">{t('extensions.tabMcp')}</TabsTrigger>
              </TabsList>
              <ExtensionAddButton
                tab={tab}
                disabled={menuDisabled}
                onAdd={() => setPage({ tab, name: null })}
              />
            </div>
            {scroll(
              <>
                <TabsContent value="skills" forceMount>
                  {skillsGroup}
                </TabsContent>
                <TabsContent value="subagents" forceMount>
                  {agentsGroup}
                </TabsContent>
                <TabsContent value="mcp" forceMount>
                  {mcpGroup}
                </TabsContent>
              </>,
            )}
          </Tabs>
        )}
      </div>
    </section>
  );
}
