import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@ai/ui/components/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ai/ui/components/tabs';
import { SettingsHeading } from '../settings/settings-heading';
import { ExtensionMcpGroup } from './extension-mcp';
import { ExtensionRolesGroup } from './extension-roles';
import { ExtensionSkillsGroup } from './extension-skills';
import { useExtensionMutations } from './use-extension-mutations';
import { useServiceMcp, useServiceRoles, useServiceSkills, useServiceStatus } from './use-service';

function matches(query: string, ...values: string[]) {
  const needle = query.trim().toLowerCase();
  return !needle || values.some((value) => value.toLowerCase().includes(needle));
}

/** Skills/roles/MCP overview for the Extensions settings page. */
export function ServiceSettings() {
  const { t } = useTranslation('settings');
  const [query, setQuery] = useState('');
  const { status } = useServiceStatus();
  const { skills, loading: skillsLoading, refresh: refreshSkills, setEnabled } = useServiceSkills();
  const { roles, loading: rolesLoading, refresh: refreshRoles } = useServiceRoles();
  const {
    mcp,
    loading: mcpLoading,
    busyId,
    refresh: refreshMcp,
    connect: mcpConnect,
    authStart,
    authComplete,
  } = useServiceMcp();
  const { busyKey, setSkillEnabled, updateSkill, putRole, mcpUpsert, mcpDisable, mcpRemove } =
    useExtensionMutations();
  const connected = status?.state === 'connected';
  const enableSeq = useRef(new Map<string, number>());
  useEffect(() => {
    if (!connected) return;
    void refreshSkills();
    void refreshRoles();
    void refreshMcp();
  }, [connected, refreshMcp, refreshRoles, refreshSkills]);
  const skillRows = (skills?.skills ?? []).filter((row) =>
    matches(query, row.name, row.description, row.sourceKind, row.revision),
  );
  const roleRows = (roles?.roles ?? []).filter((row) => matches(query, row.title, row.id));
  const mcpRows = (mcp?.servers ?? []).filter((row) =>
    matches(query, row.serverId, row.state, row.lastError),
  );
  const catalogCount =
    (skills?.skills.length ?? 0) + (roles?.roles.length ?? 0) + (mcp?.servers.length ?? 0);
  const searching = Boolean(query.trim());
  const skillBusyName = busyKey?.startsWith('skill:') ? busyKey.slice('skill:'.length) : null;
  const rolesBusy = busyKey?.startsWith('role:') ?? false;
  const mcpBusy = busyKey?.startsWith('mcp:') ?? false;
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
        <Tabs defaultValue="skills">
          <TabsList aria-label={t('extensions.tabsLabel')}>
            <TabsTrigger value="skills">{t('extensions.tabSkills')}</TabsTrigger>
            <TabsTrigger value="subagents">{t('extensions.tabSubagents')}</TabsTrigger>
            <TabsTrigger value="mcp">{t('extensions.tabMcp')}</TabsTrigger>
          </TabsList>
          <TabsContent value="skills" forceMount>
            <ExtensionSkillsGroup
              rows={skillRows}
              loading={skillsLoading}
              empty={searching ? t('extensions.noMatches') : t('service.emptySkills')}
              connected={connected}
              busyName={skillBusyName}
              onEnabled={(name, enabled) => {
                const seq = (enableSeq.current.get(name) ?? 0) + 1;
                enableSeq.current.set(name, seq);
                setEnabled(name, enabled);
                void setSkillEnabled(name, enabled).catch(() => {
                  if (enableSeq.current.get(name) === seq) setEnabled(name, !enabled);
                });
              }}
              onUpdate={(name) => void updateSkill(name, refreshSkills)}
            />
          </TabsContent>
          <TabsContent value="subagents" forceMount>
            <ExtensionRolesGroup
              rows={roleRows}
              loading={rolesLoading}
              empty={searching ? t('extensions.noMatches') : t('service.emptyRoles')}
              connected={connected}
              busy={rolesBusy}
              onSave={(input) => putRole(input, refreshRoles)}
            />
          </TabsContent>
          <TabsContent value="mcp" forceMount>
            <ExtensionMcpGroup
              rows={mcpRows}
              loading={mcpLoading}
              empty={searching ? t('extensions.noMatches') : t('service.emptyMcp')}
              connected={connected}
              busyId={busyId}
              busy={mcpBusy}
              onConnect={(serverId) => void mcpConnect(serverId)}
              onAuthStart={(serverId) => void authStart(serverId)}
              onAuthComplete={(serverId, input) => void authComplete(serverId, input)}
              onUpsert={(input) => mcpUpsert(input, refreshMcp)}
              onDisable={(serverId) => void mcpDisable(serverId, refreshMcp)}
              onRemove={(serverId) => void mcpRemove(serverId, refreshMcp)}
            />
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
