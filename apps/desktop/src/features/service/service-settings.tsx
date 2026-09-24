import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@ai/ui/components/input';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ai/ui/components/tabs';
import { showErrorToast, showToast } from '../../components/toast-store';
import { SettingsHeading } from '../settings/settings-heading';
import { ExtensionAddMenu, type ExtensionTab } from './extension-add-menu';
import { ExtensionAgentsGroup } from './extension-agents';
import { ExtensionMcpGroup } from './extension-mcp';
import { ExtensionSkillsGroup } from './extension-skills';
import { useExtensionMutations } from './use-extension-mutations';
import { useServiceAgents, useServiceMcp, useServiceSkills, useServiceStatus } from './use-service';

function createSkillName(tab: ExtensionTab): 'create-skill' | 'create-subagent' | 'create-mcp' {
  switch (tab) {
    case 'skills':
      return 'create-skill';
    case 'subagents':
      return 'create-subagent';
    case 'mcp':
      return 'create-mcp';
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

function sessionKind(tab: ExtensionTab): 'skill' | 'subagent' | 'mcp' {
  switch (tab) {
    case 'skills':
      return 'skill';
    case 'subagents':
      return 'subagent';
    case 'mcp':
      return 'mcp';
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

/** Skills/subagents/MCP overview for the Extensions settings page. */
export function ServiceSettings() {
  const { t } = useTranslation('settings');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<ExtensionTab>('skills');
  const [adding, setAdding] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const { status } = useServiceStatus();
  const { skills, loading: skillsLoading, refresh: refreshSkills, setEnabled } = useServiceSkills();
  const { agents, loading: agentsLoading, refresh: refreshAgents } = useServiceAgents();
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
    updateSkill,
    restoreBuiltin,
    installSkill,
    putAgent,
    mcpUpsert,
    mcpDisable,
    mcpRemove,
  } = useExtensionMutations();
  const connected = status?.state === 'connected';
  const catalogBusy = busyKey !== null;
  const menuDisabled = !connected || catalogBusy;
  const enableSeq = useRef(new Map<string, number>());
  useEffect(() => {
    if (!connected) return;
    void refreshSkills();
    void refreshAgents();
    void refreshMcp();
  }, [connected, refreshAgents, refreshMcp, refreshSkills]);
  const catalogCount =
    (skills?.skills.length ?? 0) + (agents?.agents.length ?? 0) + (mcp?.servers.length ?? 0);
  const searching = Boolean(query.trim());
  const skillBusyName =
    busyKey?.startsWith('skill:') && busyKey !== 'skill:install'
      ? busyKey.slice('skill:'.length)
      : null;
  const agentsBusy = busyKey?.startsWith('agent:') ?? false;
  const mcpBusy = busyKey?.startsWith('mcp:') ?? false;
  const skillInstallBusy = busyKey === 'skill:install';

  async function startAiSession() {
    const bridge = window.desktop?.settings;
    if (!bridge) return;
    const skillName = createSkillName(tab);
    const skill = skills?.skills.find((row) => row.name === skillName);
    if (skill && !skill.enabled) {
      showToast({ kind: 'error', text: t('extensions.enableCreateSkill', { name: skillName }) });
      return;
    }
    try {
      await bridge.startExtensionSession(sessionKind(tab));
      showToast({ kind: 'info', text: t('extensions.sessionOpened') });
    } catch (error) {
      showErrorToast(error);
    }
  }

  return (
    <section className="settings-extension-settings" aria-label={t('extensions.title')}>
      <SettingsHeading title={t('extensions.title')} description={t('extensions.description')}>
        <Input
          aria-label={t('extensions.searchLabel')}
          placeholder={t('extensions.searchPlaceholder')}
          value={query}
          disabled={!catalogCount}
          onChange={(event) => setQuery(event.target.value)}
        />
      </SettingsHeading>
      <div className="settings-extension-tabs">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (value !== 'skills' && value !== 'subagents' && value !== 'mcp') return;
            setTab(value);
            setAdding(false);
          }}
        >
          <div className="settings-extension-tab-row">
            <TabsList aria-label={t('extensions.tabsLabel')}>
              <TabsTrigger value="skills">{t('extensions.tabSkills')}</TabsTrigger>
              <TabsTrigger value="subagents">{t('extensions.tabSubagents')}</TabsTrigger>
              <TabsTrigger value="mcp">{t('extensions.tabMcp')}</TabsTrigger>
            </TabsList>
            <ExtensionAddMenu
              tab={tab}
              disabled={menuDisabled}
              onFillForm={() => {
                setFormKey((value) => value + 1);
                setAdding(true);
              }}
              onCreateWithAi={() => void startAiSession()}
            />
          </div>
          {/* The panel owns the scrollbar; the heading, search, and tab row stay put above it. */}
          <ScrollArea
            className="flex-1"
            viewportClassName="[&>div]:flex! [&>div]:flex-col [&>div]:min-h-full"
            gutter
            scrollShadow
          >
            <TabsContent value="skills" forceMount>
              <ExtensionSkillsGroup
                rows={skills?.skills ?? []}
                query={query}
                loading={skillsLoading}
                empty={searching ? t('extensions.noMatches') : t('service.emptySkills')}
                connected={connected}
                busyName={skillBusyName}
                adding={adding && tab === 'skills'}
                formKey={formKey}
                busy={skillInstallBusy}
                onClose={() => setAdding(false)}
                onInstall={(input) => installSkill(input, refreshSkills)}
                onEnabled={(name, enabled) => {
                  const seq = (enableSeq.current.get(name) ?? 0) + 1;
                  enableSeq.current.set(name, seq);
                  setEnabled(name, enabled);
                  void setSkillEnabled(name, enabled).catch(() => {
                    if (enableSeq.current.get(name) === seq) setEnabled(name, !enabled);
                  });
                }}
                onUpdate={(name) => void updateSkill(name, refreshSkills)}
                onRestore={(id) => restoreBuiltin(id, refreshSkills)}
              />
            </TabsContent>
            <TabsContent value="subagents" forceMount>
              <ExtensionAgentsGroup
                rows={agents?.agents ?? []}
                query={query}
                loading={agentsLoading}
                empty={searching ? t('extensions.noMatches') : t('service.emptyAgents')}
                connected={connected}
                busy={agentsBusy}
                adding={adding && tab === 'subagents'}
                formKey={formKey}
                onClose={() => setAdding(false)}
                onSave={(input) => putAgent(input, refreshAgents)}
              />
            </TabsContent>
            <TabsContent value="mcp" forceMount>
              <ExtensionMcpGroup
                rows={mcp?.servers ?? []}
                query={query}
                loading={mcpLoading}
                empty={searching ? t('extensions.noMatches') : t('service.emptyMcp')}
                connected={connected}
                busyId={busyId}
                busy={mcpBusy}
                adding={adding && tab === 'mcp'}
                formKey={formKey}
                onClose={() => setAdding(false)}
                onConnect={(serverId) => void mcpConnect(serverId)}
                onAuthStart={(serverId) => void authStart(serverId)}
                onAuthComplete={(serverId, input) => void authComplete(serverId, input)}
                onUpsert={(input) => mcpUpsert(input, refreshMcp)}
                onDisable={(serverId) => void mcpDisable(serverId, refreshMcp)}
                onRemove={(serverId) => void mcpRemove(serverId, refreshMcp)}
              />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </div>
    </section>
  );
}
