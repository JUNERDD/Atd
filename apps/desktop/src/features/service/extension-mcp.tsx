import { useState } from 'react';
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
import { matchFields, type FieldsMatch } from '@ai/ui/lib/fuzzy-match';
import { isComposingKey } from '@ai/ui/lib/ime';
import { ExtensionGroup } from './extension-group';
import { McpDetailDialog } from './extension-mcp-detail';
import { EMPTY_MCP_DRAFT, toUpsertInput, type McpUpsertInput } from './extension-mcp-draft';
import { McpAddForm } from './extension-mcp-form';
import { ExtensionRow, ExtensionRowActions } from './extension-row';
import type { ExtensionMcpRow } from './extension-rows';
import { useMcpStateLabel } from './use-mcp-state-label';

function canConnect(state: string): boolean {
  return state === 'disconnected' || state === 'error';
}

function needsAuth(state: string): boolean {
  return state === 'auth_required';
}

/**
 * One server row in the shared anatomy: icon ring, id, the translated state and last error, then
 * the enable switch and More. Connect, sign-in and remove sit in More; while the server asks for
 * sign-in, the code field stays under the row so the flow is visible.
 */
function McpRow({
  row,
  description,
  match,
  connected,
  busy,
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
  onEnabled: (enabled: boolean) => void;
  onDetails: () => void;
  onConnect: () => void;
  onAuthStart: () => void;
  onAuthComplete: (input: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('settings');
  const [authCode, setAuthCode] = useState('');
  const showConnect = canConnect(row.state);
  const showAuth = needsAuth(row.state);
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
      </ItemContent>
      <ExtensionRowActions
        name={row.serverId}
        enabled={!row.disabled}
        disabled={locked}
        onEnabledChange={onEnabled}
        onDetails={onDetails}
        menu={
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
            {showConnect || showAuth ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem disabled={locked} onSelect={onRemove}>
              <Trash2 />
              {t('extensions.remove')}
            </DropdownMenuItem>
          </>
        }
      />
    </ExtensionRow>
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

/**
 * MCP servers group with connect/auth and catalog add/enable/remove. The search matches and
 * marks the server id and the description line as shown.
 */
export function ExtensionMcpGroup({
  rows,
  query,
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
  onEnabled,
  onRemove,
}: {
  rows: ExtensionMcpRow[];
  query: string;
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
  onEnabled: (serverId: string, enabled: boolean) => void;
  onRemove: (serverId: string) => void;
}) {
  const { t } = useTranslation('settings');
  const stateLabel = useMcpStateLabel();
  const [removing, setRemoving] = useState<string | null>(null);
  // The id stays while the dialog closes; the row is read live so state changes show in it.
  const [detail, setDetail] = useState<{ serverId: string; open: boolean } | null>(null);
  const detailRow = detail ? rows.find((row) => row.serverId === detail.serverId) : undefined;
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
  const shown = rows.flatMap((row) => {
    const description = [stateLabel(row.state), row.lastError].filter(Boolean).join(' · ');
    const match = matchFields(query, { serverId: row.serverId, description });
    return match || !query.trim() ? [{ row, description, match }] : [];
  });
  return (
    <>
      {form}
      <ExtensionGroup
        title={t('extensions.tabMcp')}
        empty={empty}
        loading={loading}
        hasRows={shown.length > 0}
        showTitle={false}
        emptyIcon={<Plug />}
      >
        {shown.map(({ row, description, match }) => (
          <McpRow
            key={row.serverId}
            row={row}
            description={description}
            match={match}
            connected={connected}
            busy={busy || busyId === row.serverId}
            onEnabled={(enabled) => onEnabled(row.serverId, enabled)}
            onDetails={() => setDetail({ serverId: row.serverId, open: true })}
            onConnect={() => onConnect(row.serverId)}
            onAuthStart={() => onAuthStart(row.serverId)}
            onAuthComplete={(input) => onAuthComplete(row.serverId, input)}
            onRemove={() => setRemoving(row.serverId)}
          />
        ))}
      </ExtensionGroup>
      {detailRow ? (
        <McpDetailDialog
          row={detailRow}
          open={detail?.open ?? false}
          onOpenChange={(open) => setDetail({ serverId: detailRow.serverId, open })}
        />
      ) : null}
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
