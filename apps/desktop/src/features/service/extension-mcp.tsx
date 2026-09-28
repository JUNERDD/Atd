import { useId, useState } from 'react';
import { KeyRound, Plug, PlugZap, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@ai/ui/components/alert-dialog';
import { Button } from '@ai/ui/components/button';
import { DropdownMenuItem, DropdownMenuSeparator } from '@ai/ui/components/dropdown-menu';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import { Input } from '@ai/ui/components/input';
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@ai/ui/components/item';
import { Label } from '@ai/ui/components/label';
import { Switch } from '@ai/ui/components/switch';
import type { FieldsMatch } from '@ai/ui/lib/fuzzy-match';
import { isComposingKey } from '@ai/ui/lib/ime';
import { ExtensionGroup } from './extension-group';
import { ExtensionRow, ExtensionRowActions } from './extension-row';
import type { ExtensionMcpRow } from './extension-rows';
import type { McpMatch } from './use-extension-matches';
import { mcpCanConnect, mcpNeedsAuth } from './use-mcp-state-label';

/**
 * One server row in the shared anatomy: icon ring, id, the translated state and last error, then
 * the enable switch and More. Connect, sign-in and (for Personal servers) remove sit in More;
 * while the server asks for sign-in, the code field stays under the row so the flow is visible.
 * An installed plugin's local command waits for Allow to run, which also stays under the row.
 */
function McpRow({
  row,
  description,
  match,
  connected,
  busy,
  lockedReason,
  onApprove,
  onEnabled,
  onDetails,
  onConnect,
  onAuthStart,
  onAuthComplete,
  onRemove,
}: {
  row: ExtensionMcpRow;
  description: string;
  /** Where the search matched the server id and the description line. */
  match: FieldsMatch<'serverId' | 'description'> | null;
  connected: boolean;
  busy: boolean;
  lockedReason: string | null;
  /** Set while the server waits for the user to allow its local command to run. */
  onApprove: (() => void) | null;
  onEnabled: (enabled: boolean) => void;
  onDetails: () => void;
  onConnect: () => void;
  onAuthStart: () => void;
  onAuthComplete: (input: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('settings');
  const [authCode, setAuthCode] = useState('');
  const approveId = useId();
  const showConnect = mcpCanConnect(row.state);
  const showAuth = mcpNeedsAuth(row.state);
  const locked = !connected || busy;
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
        {showAuth ? (
          <div className="settings-extension-mcp-auth">
            <Input
              aria-label={t('extensions.authCodeLabel')}
              placeholder={t('extensions.authCodePlaceholder')}
              value={authCode}
              disabled={locked}
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
              disabled={locked || !authCode.trim()}
              onClick={() => onAuthComplete(authCode.trim())}
            >
              {t('extensions.authSubmit')}
            </Button>
          </div>
        ) : null}
        {onApprove ? (
          <div className="settings-extension-mcp-approval">
            <Switch
              id={approveId}
              size="sm"
              checked={false}
              disabled={locked}
              onCheckedChange={(approved) => {
                if (approved) onApprove();
              }}
            />
            <Label htmlFor={approveId}>{t('extensions.plugins.page.allowRun')}</Label>
          </div>
        ) : null}
      </ItemContent>
      <ExtensionRowActions
        name={row.serverId}
        enabled={!row.disabled}
        disabled={locked}
        onEnabledChange={onEnabled}
        onDetails={onDetails}
        lockedReason={lockedReason}
        menu={
          showConnect || showAuth || !row.readOnly ? (
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
              {(showConnect || showAuth) && !row.readOnly ? <DropdownMenuSeparator /> : null}
              {row.readOnly ? null : (
                <DropdownMenuItem disabled={locked} onSelect={onRemove}>
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
 * One plugin's MCP servers with connect/auth, enable, and remove for Personal servers; a row opens
 * that server's details page. `items` are the servers shown, with search marks.
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
  lockedReason,
  needsApproval,
  onApprove,
  onOpen,
  onConnect,
  onAuthStart,
  onAuthComplete,
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
  /** Why the switches are locked (their plugin is off); null when they are not. */
  lockedReason: string | null;
  /** Whether a server waits for Allow to run (an installed plugin's local command). */
  needsApproval: (serverId: string) => boolean;
  onApprove: (serverId: string) => void;
  onOpen: (serverId: string) => void;
  onConnect: (serverId: string) => void;
  onAuthStart: (serverId: string) => void;
  onAuthComplete: (serverId: string, input: string) => void;
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
            lockedReason={lockedReason}
            onApprove={needsApproval(row.serverId) ? () => onApprove(row.serverId) : null}
            onEnabled={(enabled) => onEnabled(row.serverId, enabled)}
            onDetails={() => onOpen(row.serverId)}
            onConnect={() => onConnect(row.serverId)}
            onAuthStart={() => onAuthStart(row.serverId)}
            onAuthComplete={(input) => onAuthComplete(row.serverId, input)}
            onRemove={() => setRemoving(row.serverId)}
          />
        ))}
      </ExtensionGroup>
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('extensions.removeTitle', { name: removing ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('extensions.removeDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('extensions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing) onRemove(removing);
              }}
            >
              {t('extensions.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
