import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { messageOf } from '../../lib/errors';
import { ExtensionDetailDialog, type DetailField } from './extension-detail-dialog';
import { asMcpConfig, type ExtensionMcpConfig, type ExtensionMcpRow } from './extension-rows';
import { useMcpStateLabel } from './use-mcp-state-label';

type Loaded =
  | { serverId: string; config: ExtensionMcpConfig | null }
  | { serverId: string; error: string };

/** Reads the configured record behind one server each time its details open. */
function useMcpConfig(serverId: string | null): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    const bridge = window.desktop?.service;
    if (!serverId || !bridge) return;
    let active = true;
    bridge.mcpServers().then(
      (result) => {
        if (!active) return;
        const configs = result.servers.flatMap((record) => asMcpConfig(record) ?? []);
        setLoaded({
          serverId,
          config: configs.find((config) => config.serverId === serverId) ?? null,
        });
      },
      (error: unknown) => {
        if (active) setLoaded({ serverId, error: messageOf(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [serverId]);
  return loaded?.serverId === serverId ? loaded : null;
}

function authLabelKey(
  auth: NonNullable<ExtensionMcpConfig['auth']>,
): 'extensions.authNone' | 'extensions.authBearer' | 'extensions.authOauth' {
  switch (auth) {
    case 'none':
      return 'extensions.authNone';
    case 'bearer':
      return 'extensions.authBearer';
    case 'oauth':
      return 'extensions.authOauth';
    default: {
      const _exhaustive: never = auth;
      return _exhaustive;
    }
  }
}

/**
 * MCP server details: the live connection state and what it offers from the status row, and how
 * it connects from the configured record. Header and environment values are never shown.
 */
export function McpDetailDialog({
  row,
  open,
  onOpenChange,
}: {
  row: ExtensionMcpRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('settings');
  const stateLabel = useMcpStateLabel();
  const loaded = useMcpConfig(open ? row.serverId : null);
  const config = loaded && 'config' in loaded ? loaded.config : null;
  const status = !loaded
    ? { text: t('extensions.detailLoading'), error: false }
    : 'error' in loaded
      ? { text: loaded.error, error: true }
      : config
        ? null
        : { text: t('extensions.detailMissing'), error: true };
  const fields: DetailField[] = config
    ? [
        { label: t('extensions.transport'), value: config.transport },
        ...(config.url
          ? [{ label: t('extensions.url'), value: config.url, mono: true }]
          : [
              {
                label: t('extensions.command'),
                value: [config.command, ...config.args].join(' '),
                mono: true,
              },
            ]),
        ...(config.auth
          ? [{ label: t('extensions.authentication'), value: t(authLabelKey(config.auth)) }]
          : []),
        {
          label: t('extensions.detailOffers'),
          value: t('extensions.mcpOffers', {
            tools: row.toolCount,
            resources: row.resourceCount,
            prompts: row.promptCount,
          }),
        },
        ...(row.lastError
          ? [{ label: t('extensions.detailLastError'), value: row.lastError }]
          : []),
      ]
    : [];
  return (
    <ExtensionDetailDialog
      open={open}
      onOpenChange={onOpenChange}
      title={row.serverId}
      description={t('extensions.mcpDetailDescription')}
      badge={{
        label: stateLabel(row.state),
        tone: row.state === 'error' ? 'error' : row.disabled ? 'off' : 'on',
      }}
      fields={fields}
      status={status}
    />
  );
}
