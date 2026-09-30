import { Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import {
  ExtensionDetailFields,
  ExtensionDetailSection,
  ExtensionDetailStatus,
  type DetailField,
} from './extension-detail-fields';
import { McpStatusSection } from './extension-mcp-status';
import { draftFromConfig, EMPTY_MCP_DRAFT, type McpUpsertInput } from './extension-mcp-draft';
import { McpEditor } from './extension-mcp-editor';
import type { ExtensionMcpConfig } from './extension-detail-rows';
import { ExtensionPage, type ExtensionPageBadge } from './extension-page';
import { ExtensionRemoveButton } from './extension-remove-dialog';
import type { ExtensionMcpRow } from './extension-rows';
import { useMcpConfig } from './use-mcp-config';
import { useMcpStateLabel } from './use-mcp-state-label';

type McpPageProps = {
  serverId: string | null;
  rows: readonly ExtensionMcpRow[];
  backLabel: string;
  connected: boolean;
  busy: boolean;
  onBack: () => void;
  onUpsert: (input: McpUpsertInput) => Promise<boolean>;
  onConnect: (serverId: string) => void;
  onAuthStart: (serverId: string) => void;
  onRequestApproval: (serverId: string) => void;
  onWithdrawApproval: (serverId: string) => void;
  onStartAi: (target: string | null) => void;
  /** Copies a plugin's read-only server into Personal. */
  onDuplicate: () => void;
  /** Removes a Personal server once the confirmation is accepted. */
  onRemove: () => void;
};

/**
 * Settings in the record the form has no control for. Saving keeps them for the same kind of
 * transport (env vars and headers by name: their values never reach this page) and drops them
 * when the transport switches between stdio and HTTP, which the note says.
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

/** A plugin server's connection as facts: it cannot be edited, only duplicated to Personal. */
function McpConnectionFacts({ config }: { config: ExtensionMcpConfig | null }) {
  const { t } = useTranslation('settings');
  if (!config) return null;
  const fields: DetailField[] = [
    { label: t('extensions.transport'), value: config.transport, mono: true },
    ...(config.transport === 'stdio'
      ? [
          {
            label: t('extensions.command'),
            value: [config.command, ...config.args].join(' '),
            mono: true,
          },
        ]
      : [{ label: t('extensions.url'), value: config.url, mono: true }]),
  ];
  return (
    <ExtensionDetailSection label={t('extensions.mcpPage.connectionSection')}>
      <ExtensionDetailFields fields={fields} />
    </ExtensionDetailSection>
  );
}

/**
 * One server's details: its status, then its connection prefilled from the configured record, with
 * Remove for a Personal server.
 */
function McpDetailsPage({ serverId, ...props }: McpPageProps & { serverId: string }) {
  const { t } = useTranslation('settings');
  const stateLabel = useMcpStateLabel();
  const row = props.rows.find((item) => item.serverId === serverId);
  const loaded = useMcpConfig(serverId, Boolean(row));
  const config = loaded && 'config' in loaded ? loaded.config : null;
  const tone: ExtensionPageBadge['tone'] =
    row?.state === 'error'
      ? 'error'
      : row?.disabled || row?.state === 'approval_required'
        ? 'off'
        : 'on';
  const badge = row ? { label: stateLabel(row.state), tone } : null;
  const status = (
    <McpStatusSection
      row={row}
      locked={!props.connected || props.busy}
      onConnect={() => props.onConnect(serverId)}
      onAuthStart={() => props.onAuthStart(serverId)}
      onRequestApproval={() => props.onRequestApproval(serverId)}
      onWithdrawApproval={() => props.onWithdrawApproval(serverId)}
    />
  );
  // A plugin's server shows its status and connection whether or not the user catalog has it.
  if (row?.readOnly)
    return (
      <ExtensionPage
        label={t('extensions.mcpPage.label')}
        title={serverId}
        badge={badge}
        description={t('extensions.mcpDetailDescription')}
        backLabel={props.backLabel}
        actions={
          <Button
            type="button"
            variant="glass"
            disabled={!props.connected || props.busy}
            onClick={props.onDuplicate}
          >
            <Copy data-icon="inline-start" />
            {t('extensions.plugins.item.duplicate')}
          </Button>
        }
      >
        {status}
        <McpConnectionFacts config={config} />
      </ExtensionPage>
    );
  if (!config) {
    const loadStatus = !loaded
      ? { text: t('extensions.detailLoading'), error: false }
      : 'error' in loaded
        ? { text: loaded.error, error: true }
        : { text: t('extensions.detailMissing'), error: true };
    return (
      <ExtensionPage
        label={t('extensions.mcpPage.label')}
        title={serverId}
        badge={badge}
        backLabel={props.backLabel}
      >
        <ExtensionDetailStatus text={loadStatus.text} error={loadStatus.error} />
      </ExtensionPage>
    );
  }
  return (
    <McpEditor
      serverId={serverId}
      initial={draftFromConfig(config)}
      takenIds={[]}
      saved={config}
      badge={badge}
      backLabel={props.backLabel}
      connected={props.connected}
      busy={props.busy}
      before={status}
      after={<McpUnkeptSection config={config} />}
      remove={
        <ExtensionRemoveButton
          name={serverId}
          label={t('extensions.remove')}
          title={t('extensions.removeTitle', { name: serverId })}
          description={t('extensions.removeDescription')}
          disabled={!props.connected || props.busy}
          onConfirm={props.onRemove}
        />
      }
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
      backLabel={props.backLabel}
      connected={props.connected}
      busy={props.busy}
      onBack={props.onBack}
      onUpsert={props.onUpsert}
      onStartAi={props.onStartAi}
    />
  );
}
