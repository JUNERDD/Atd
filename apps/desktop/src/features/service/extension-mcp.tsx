import { useState } from 'react';
import { CircleAlert, KeyRound, Plug, PlugZap, ShieldOff, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { DropdownMenuItem, DropdownMenuSeparator } from '@atd/ui/components/dropdown-menu';
import { HighlightedText } from '@atd/ui/components/highlighted-text';
import { Input } from '@atd/ui/components/input';
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@atd/ui/components/item';
import type { FieldsMatch } from '@atd/ui/lib/fuzzy-match';
import { isComposingKey } from '@atd/ui/lib/ime';
import { ExtensionGroup } from './extension-group';
import { ExtensionRemoveDialog } from './extension-remove-dialog';
import { ExtensionRow, ExtensionRowActions } from './extension-row';
import type { ExtensionMcpRow } from './extension-rows';
import type { McpMatch } from './use-extension-matches';
import { canConfirmMcpApproval } from './use-service-mcp';
import { mcpCanConnect, mcpNeedsApproval, mcpNeedsAuth } from './use-mcp-state-label';

/**
 * One server row in the shared anatomy: icon ring, id, then its launch approval while it waits for
 * one, the translated state and last error, then the switch and More. The switch is on only when
 * the server may run: enabled and, when it needs one, approved. Turning it on enables the server
 * and asks for the approval it lacks through the host's native dialog, which a cancel leaves off;
 * turning it off disables the server and keeps its approval. Connect, sign-in, Withdraw approval
 * and (for Personal servers) remove sit in More; while the server asks for sign-in, the code field
 * stays under the row so the flow is visible, and a step that failed says why under the
 * description. While a step runs, the row's controls keep their focus but ignore input.
 */
function McpRow({
  row,
  description,
  match,
  connected,
  busy,
  issue,
  lockedReason,
  onEnabled,
  onDetails,
  onConnect,
  onAuthStart,
  onAuthComplete,
  onRequestApproval,
  onWithdrawApproval,
  onRemove,
}: {
  row: ExtensionMcpRow;
  description: string;
  /** Where the search matched the server id and the description line. */
  match: FieldsMatch<'serverId' | 'description'> | null;
  connected: boolean;
  busy: boolean;
  /** Why the server's last step failed, until its next one. */
  issue: string | null;
  lockedReason: string | null;
  onEnabled: (enabled: boolean) => void;
  onDetails: () => void;
  onConnect: () => void;
  onAuthStart: () => void;
  onAuthComplete: (input: string) => void;
  onRequestApproval: () => void;
  onWithdrawApproval: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('settings');
  const [authCode, setAuthCode] = useState('');
  const needsApproval = mcpNeedsApproval(row.approval);
  // A launch waiting for approval would only be refused, so the switch asks for it first.
  const showConnect = mcpCanConnect(row.state) && !needsApproval;
  const showAuth = mcpNeedsAuth(row.state);
  const showWithdraw = row.approval === 'approved';
  const locked = !connected || busy;
  const steps = showConnect || showAuth || showWithdraw;
  const setRunnable = (on: boolean) => {
    if (!on || row.disabled) onEnabled(on);
    if (on && needsApproval && canConfirmMcpApproval()) onRequestApproval();
  };
  return (
    <ExtensionRow name={row.serverId} onDetails={onDetails}>
      <ItemMedia variant="icon">
        <Plug />
      </ItemMedia>
      <ItemContent>
        <ItemTitle title={row.serverId}>
          <HighlightedText text={row.serverId} ranges={match?.ranges.serverId} />
        </ItemTitle>
        {description ? (
          <ItemDescription title={description}>
            <HighlightedText text={description} ranges={match?.ranges.description} />
          </ItemDescription>
        ) : null}
        {issue ? (
          <p className="settings-inline-error" role="alert">
            <CircleAlert aria-hidden />
            <span>{issue}</span>
          </p>
        ) : null}
        {showAuth ? (
          <div className="settings-extension-mcp-auth">
            <Input
              aria-label={t('extensions.authCodeLabel')}
              placeholder={t('extensions.authCodePlaceholder')}
              value={authCode}
              disabled={!connected}
              readOnly={busy}
              onChange={(event) => setAuthCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || isComposingKey(event) || !authCode.trim() || locked)
                  return;
                event.preventDefault();
                onAuthComplete(authCode.trim());
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!connected || !authCode.trim()}
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              className="aria-disabled:opacity-50"
              onClick={() => {
                if (!busy) onAuthComplete(authCode.trim());
              }}
            >
              {t('extensions.authSubmit')}
            </Button>
          </div>
        ) : null}
      </ItemContent>
      <ExtensionRowActions
        name={row.serverId}
        enabled={!row.disabled && !needsApproval}
        disabled={!connected}
        pending={busy}
        onEnabledChange={setRunnable}
        onDetails={onDetails}
        lockedReason={lockedReason}
        menu={
          steps || !row.readOnly ? (
            <>
              {showConnect ? (
                <DropdownMenuItem disabled={locked} onSelect={onConnect}>
                  <PlugZap />
                  {t('extensions.connect')}
                </DropdownMenuItem>
              ) : null}
              {showAuth ? (
                <DropdownMenuItem disabled={locked} onSelect={onAuthStart}>
                  <KeyRound />
                  {t('extensions.authenticate')}
                </DropdownMenuItem>
              ) : null}
              {showWithdraw ? (
                <DropdownMenuItem disabled={locked} onSelect={onWithdrawApproval}>
                  <ShieldOff />
                  {t('extensions.mcpApproval.withdraw')}
                </DropdownMenuItem>
              ) : null}
              {steps && !row.readOnly ? <DropdownMenuSeparator /> : null}
              {row.readOnly ? null : (
                <DropdownMenuItem variant="destructive" disabled={locked} onSelect={onRemove}>
                  <Trash2 />
                  {t('extensions.remove')}
                </DropdownMenuItem>
              )}
            </>
          ) : null
        }
      />
    </ExtensionRow>
  );
}

/**
 * One plugin's MCP servers with connect/auth, launch approval, enable, and remove for Personal
 * servers; a row opens that server's details page. `items` are the servers shown, with search marks.
 */
export function ExtensionMcpGroup({
  title,
  showTitle = true,
  items,
  loading,
  empty,
  connected,
  busyId,
  busy,
  issues,
  lockedReason,
  onOpen,
  onConnect,
  onAuthStart,
  onAuthComplete,
  onRequestApproval,
  onWithdrawApproval,
  onEnabled,
  onRemove,
}: {
  title: string;
  /** False when a tab names the kind; the section keeps its name for accessibility. */
  showTitle?: boolean;
  items: McpMatch[];
  loading: boolean;
  empty: string;
  connected: boolean;
  busyId: string | null;
  busy: boolean;
  /** Why each server's last step failed, by server id. */
  issues: Readonly<Record<string, string>>;
  /** Why the switches are locked (their plugin is off); null when they are not. */
  lockedReason: string | null;
  onOpen: (serverId: string) => void;
  onConnect: (serverId: string) => void;
  onAuthStart: (serverId: string) => void;
  onAuthComplete: (serverId: string, input: string) => void;
  onRequestApproval: (serverId: string) => void;
  onWithdrawApproval: (serverId: string) => void;
  onEnabled: (serverId: string, enabled: boolean) => void;
  onRemove: (serverId: string) => void;
}) {
  const { t } = useTranslation('settings');
  const [removing, setRemoving] = useState<string | null>(null);
  return (
    <>
      <ExtensionGroup
        title={title}
        showTitle={showTitle}
        empty={empty}
        loading={loading}
        hasRows={items.length > 0}
        emptyIcon={<Plug />}
      >
        {items.map(({ row, description, match }) => (
          <McpRow
            key={row.serverId}
            row={row}
            description={description}
            match={match}
            connected={connected}
            busy={busy || busyId === row.serverId}
            issue={issues[row.serverId] ?? null}
            lockedReason={lockedReason}
            onEnabled={(enabled) => onEnabled(row.serverId, enabled)}
            onDetails={() => onOpen(row.serverId)}
            onConnect={() => onConnect(row.serverId)}
            onAuthStart={() => onAuthStart(row.serverId)}
            onAuthComplete={(input) => onAuthComplete(row.serverId, input)}
            onRequestApproval={() => onRequestApproval(row.serverId)}
            onWithdrawApproval={() => onWithdrawApproval(row.serverId)}
            onRemove={() => setRemoving(row.serverId)}
          />
        ))}
      </ExtensionGroup>
      <ExtensionRemoveDialog
        name={removing}
        title={t('extensions.removeTitle', { name: removing ?? '' })}
        description={t('extensions.removeDescription')}
        confirm={t('extensions.remove')}
        onCancel={() => setRemoving(null)}
        onConfirm={onRemove}
      />
    </>
  );
}
