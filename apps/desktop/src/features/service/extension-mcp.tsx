import { useState } from 'react';
import { Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@ai/ui/components/item';
import { ExtensionGroup } from './extension-group';
import { EMPTY_MCP_DRAFT, toUpsertInput, type McpUpsertInput } from './extension-mcp-draft';
import { McpAddForm } from './extension-mcp-form';
import type { ExtensionMcpRow } from './use-service';

function mcpDescription(row: ExtensionMcpRow): string {
  return [row.state, row.lastError].filter(Boolean).join(' · ');
}

function canConnect(state: string): boolean {
  return state === 'disconnected' || state === 'error';
}

function needsAuth(state: string): boolean {
  return state === 'auth_required';
}

function McpRow({
  row,
  connected,
  busy,
  onConnect,
  onAuthStart,
  onAuthComplete,
  onDisable,
  onRemove,
}: {
  row: ExtensionMcpRow;
  connected: boolean;
  busy: boolean;
  onConnect: (serverId: string) => void;
  onAuthStart: (serverId: string) => void;
  onAuthComplete: (serverId: string, input: string) => void;
  onDisable: (serverId: string) => void;
  onRemove: (serverId: string) => void;
}) {
  const { t } = useTranslation('settings');
  const [authCode, setAuthCode] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const description = mcpDescription(row);
  const showConnect = canConnect(row.state);
  const showAuth = needsAuth(row.state);
  return (
    <Item asChild size="xs">
      <li>
        <ItemContent>
          <ItemTitle title={row.serverId}>{row.serverId}</ItemTitle>
          {description ? (
            <ItemDescription title={description}>{description}</ItemDescription>
          ) : null}
          {showAuth ? (
            <div className="settings-extension-mcp-auth">
              <Input
                aria-label={t('extensions.authCodeLabel')}
                placeholder={t('extensions.authCodePlaceholder')}
                value={authCode}
                disabled={!connected || busy}
                onChange={(event) => setAuthCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || !authCode.trim() || !connected || busy) return;
                  event.preventDefault();
                  onAuthComplete(row.serverId, authCode.trim());
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!connected || busy || !authCode.trim()}
                onClick={() => onAuthComplete(row.serverId, authCode.trim())}
              >
                {t('extensions.authSubmit')}
              </Button>
            </div>
          ) : null}
        </ItemContent>
        <ItemActions>
          {showConnect ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!connected || busy}
              onClick={() => onConnect(row.serverId)}
            >
              {t('extensions.connect')}
            </Button>
          ) : null}
          {showAuth ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!connected || busy}
              onClick={() => onAuthStart(row.serverId)}
            >
              {t('extensions.authenticate')}
            </Button>
          ) : null}
          {connected ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || row.state === 'disabled'}
                onClick={() => onDisable(row.serverId)}
              >
                {t('extensions.disable')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (!confirmRemove) {
                    setConfirmRemove(true);
                    return;
                  }
                  setConfirmRemove(false);
                  onRemove(row.serverId);
                }}
              >
                {confirmRemove ? t('extensions.confirmRemove') : t('extensions.remove')}
              </Button>
            </>
          ) : null}
        </ItemActions>
      </li>
    </Item>
  );
}

function McpAddSection({
  busy,
  onCancel,
  onSave,
}: {
  busy: boolean;
  onCancel: () => void;
  onSave: (input: McpUpsertInput) => void;
}) {
  const [draft, setDraft] = useState(EMPTY_MCP_DRAFT);
  return (
    <McpAddForm
      draft={draft}
      busy={busy}
      onChange={setDraft}
      onCancel={onCancel}
      onSave={() => onSave(toUpsertInput(draft))}
    />
  );
}

/** MCP servers group with connect/auth and catalog add/disable/remove. */
export function ExtensionMcpGroup({
  rows,
  loading,
  empty,
  connected,
  busyId,
  busy,
  adding,
  formKey,
  onClose,
  onConnect,
  onAuthStart,
  onAuthComplete,
  onUpsert,
  onDisable,
  onRemove,
}: {
  rows: ExtensionMcpRow[];
  loading: boolean;
  empty: string;
  connected: boolean;
  busyId: string | null;
  busy: boolean;
  adding: boolean;
  formKey: number;
  onClose: () => void;
  onConnect: (serverId: string) => void;
  onAuthStart: (serverId: string) => void;
  onAuthComplete: (serverId: string, input: string) => void;
  onUpsert: (input: McpUpsertInput) => Promise<boolean>;
  onDisable: (serverId: string) => void;
  onRemove: (serverId: string) => void;
}) {
  const { t } = useTranslation('settings');
  const note = `${t('service.mcpNote')} ${t('extensions.mcpCatalogNote')}`;
  const form =
    adding && connected ? (
      <McpAddSection
        key={formKey}
        busy={busy}
        onCancel={onClose}
        onSave={(input) => {
          void onUpsert(input).then((ok) => {
            if (ok) onClose();
          });
        }}
      />
    ) : null;
  return (
    <>
      {form}
      <ExtensionGroup
        title={t('extensions.tabMcp')}
        note={note}
        empty={empty}
        loading={loading}
        hasRows={rows.length > 0}
        showTitle={false}
        emptyIcon={<Plug />}
      >
        {rows.map((row) => (
          <McpRow
            key={row.serverId}
            row={row}
            connected={connected}
            busy={busy || busyId === row.serverId}
            onConnect={onConnect}
            onAuthStart={onAuthStart}
            onAuthComplete={onAuthComplete}
            onDisable={onDisable}
            onRemove={onRemove}
          />
        ))}
      </ExtensionGroup>
    </>
  );
}
