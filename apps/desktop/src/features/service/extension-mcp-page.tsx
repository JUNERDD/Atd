import { KeyRound, PlugZap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import {
  ExtensionDetailFields,
  ExtensionDetailSection,
  ExtensionDetailStatus,
  type DetailField,
} from './extension-detail-fields';
import { draftFromConfig, EMPTY_MCP_DRAFT, type McpUpsertInput } from './extension-mcp-draft';
import { McpEditor } from './extension-mcp-editor';
import { ExtensionPage, type ExtensionPageBadge } from './extension-page';
import type { ExtensionMcpConfig, ExtensionMcpRow } from './extension-rows';
import { useMcpConfig } from './use-mcp-config';
import { mcpCanConnect, mcpNeedsAuth, useMcpStateLabel } from './use-mcp-state-label';

type McpPageProps = {
  serverId: string | null;
  rows: readonly ExtensionMcpRow[];
  connected: boolean;
  busy: boolean;
  onBack: () => void;
  onUpsert: (input: McpUpsertInput) => Promise<boolean>;
  onConnect: (serverId: string) => void;
  onAuthStart: (serverId: string) => void;
  onStartAi: (target: string | null) => void;
};

/**
 * The live side of a server: its state, what it offers and its last error, with Connect or
 * Authenticate when the state calls for it. The row is absent until the status list has it.
 */
function McpStatusSection({
  row,
  locked,
  onConnect,
  onAuthStart,
}: {
  row: ExtensionMcpRow | undefined;
  locked: boolean;
  onConnect: () => void;
  onAuthStart: () => void;
}) {
  const { t } = useTranslation('settings');
  const stateLabel = useMcpStateLabel();
  const label = t('extensions.mcpPage.statusSection');
  if (!row)
    return (
      <ExtensionDetailSection label={label}>
        <ExtensionDetailStatus text={t('extensions.detailLoading')} error={false} />
      </ExtensionDetailSection>
    );
  const fields: DetailField[] = [
    { label: t('extensions.mcpPage.state'), value: stateLabel(row.state) },
    {
      label: t('extensions.detailOffers'),
      value: t('extensions.mcpOffers', {
        tools: row.toolCount,
        resources: row.resourceCount,
        prompts: row.promptCount,
      }),
    },
    ...(row.lastError ? [{ label: t('extensions.detailLastError'), value: row.lastError }] : []),
  ];
  const showConnect = mcpCanConnect(row.state);
  const showAuth = mcpNeedsAuth(row.state);
  return (
    <ExtensionDetailSection label={label}>
      <ExtensionDetailFields fields={fields} />
      {showConnect || showAuth ? (
        <div className="flex flex-wrap items-center gap-2">
          {showConnect ? (
            <Button type="button" variant="outline" size="sm" disabled={locked} onClick={onConnect}>
              <PlugZap data-icon="inline-start" />
              {t('extensions.connect')}
            </Button>
          ) : null}
          {showAuth ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={locked}
              onClick={onAuthStart}
            >
              <KeyRound data-icon="inline-start" />
              {t('extensions.authenticate')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {showAuth ? (
        <p className="text-muted-foreground text-xs">{t('extensions.mcpPage.authCodeNote')}</p>
      ) : null}
    </ExtensionDetailSection>
  );
}

/**
 * Settings in the record the form has no control for. `mcpUpsert` rebuilds the transport block
 * from the form, so saving drops them; they are listed by name (never by value) with that
 * warning rather than lost silently.
 */
function McpUnkeptSection({ config }: { config: ExtensionMcpConfig }) {
  const { t } = useTranslation('settings');
  const fields: DetailField[] = [
    ...(config.envNames.length
      ? [{ label: t('extensions.mcpPage.envVars'), value: config.envNames.join(', '), mono: true }]
      : []),
    ...(config.cwd
      ? [{ label: t('extensions.mcpPage.workingDirectory'), value: config.cwd, mono: true }]
      : []),
    ...(config.headerNames.length
      ? [
          {
            label: t('extensions.mcpPage.headers'),
            value: config.headerNames.join(', '),
            mono: true,
          },
        ]
      : []),
    ...(config.oauthScope
      ? [{ label: t('extensions.mcpPage.oauthScope'), value: config.oauthScope, mono: true }]
      : []),
    ...(config.redirectUri
      ? [{ label: t('extensions.mcpPage.redirectUri'), value: config.redirectUri, mono: true }]
      : []),
  ];
  if (!fields.length) return null;
  return (
    <ExtensionDetailSection label={t('extensions.mcpPage.unkeptSection')}>
      <ExtensionDetailFields fields={fields} />
      <p className="text-muted-foreground text-xs">{t('extensions.mcpPage.unkeptNote')}</p>
    </ExtensionDetailSection>
  );
}

/** One server's details: its status, then its connection prefilled from the configured record. */
function McpDetailsPage({ serverId, ...props }: McpPageProps & { serverId: string }) {
  const { t } = useTranslation('settings');
  const stateLabel = useMcpStateLabel();
  const row = props.rows.find((item) => item.serverId === serverId);
  const loaded = useMcpConfig(serverId, Boolean(row));
  const config = loaded && 'config' in loaded ? loaded.config : null;
  const tone: ExtensionPageBadge['tone'] =
    row?.state === 'error' ? 'error' : row?.disabled ? 'off' : 'on';
  const badge = row ? { label: stateLabel(row.state), tone } : null;
  if (!config) {
    const status = !loaded
      ? { text: t('extensions.detailLoading'), error: false }
      : 'error' in loaded
        ? { text: loaded.error, error: true }
        : { text: t('extensions.detailMissing'), error: true };
    return (
      <ExtensionPage
        label={t('extensions.mcpPage.label')}
        title={serverId}
        badge={badge}
        backLabel={t('extensions.mcpPage.back')}
        onBack={props.onBack}
      >
        <ExtensionDetailStatus text={status.text} error={status.error} />
      </ExtensionPage>
    );
  }
  return (
    <McpEditor
      serverId={serverId}
      initial={draftFromConfig(config)}
      takenIds={[]}
      badge={badge}
      connected={props.connected}
      busy={props.busy}
      before={
        <McpStatusSection
          row={row}
          locked={!props.connected || props.busy}
          onConnect={() => props.onConnect(serverId)}
          onAuthStart={() => props.onAuthStart(serverId)}
        />
      }
      after={<McpUnkeptSection config={config} />}
      onBack={props.onBack}
      onUpsert={props.onUpsert}
      onStartAi={props.onStartAi}
    />
  );
}

/**
 * MCP server sub-page. `serverId` null is the add page; an id is that server's details with its
 * editable connection.
 */
export function McpPage(props: McpPageProps) {
  if (props.serverId !== null) return <McpDetailsPage {...props} serverId={props.serverId} />;
  return (
    <McpEditor
      serverId={null}
      initial={EMPTY_MCP_DRAFT}
      takenIds={props.rows.map((row) => row.serverId)}
      connected={props.connected}
      busy={props.busy}
      onBack={props.onBack}
      onUpsert={props.onUpsert}
      onStartAi={props.onStartAi}
    />
  );
}
