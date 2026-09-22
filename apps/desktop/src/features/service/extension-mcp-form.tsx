import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import type { McpAuthKind, McpDraft, McpTransport } from './extension-mcp-draft';

/** Draft form for adding one MCP server; main merges into the full catalog. */
export function McpAddForm({
  draft,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  draft: McpDraft;
  busy: boolean;
  onChange: (next: McpDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation('settings');
  const isStdio = draft.transport === 'stdio';
  return (
    <form
      className="settings-extension-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <label className="settings-extension-field">
        <span>{t('extensions.serverId')}</span>
        <Input
          value={draft.serverId}
          disabled={busy}
          onChange={(event) => onChange({ ...draft, serverId: event.target.value })}
          required
        />
      </label>
      <label className="settings-extension-field">
        <span>{t('extensions.transport')}</span>
        <select
          className="settings-extension-select"
          value={draft.transport}
          disabled={busy}
          onChange={(event) =>
            onChange({ ...draft, transport: event.target.value as McpTransport })
          }
        >
          <option value="stdio">stdio</option>
          <option value="streamable-http">streamable-http</option>
          <option value="sse">sse</option>
        </select>
      </label>
      {isStdio ? (
        <>
          <label className="settings-extension-field">
            <span>{t('extensions.command')}</span>
            <Input
              value={draft.command}
              disabled={busy}
              onChange={(event) => onChange({ ...draft, command: event.target.value })}
              required
            />
          </label>
          <label className="settings-extension-field">
            <span>{t('extensions.arguments')}</span>
            <Input
              value={draft.argsText}
              disabled={busy}
              onChange={(event) => onChange({ ...draft, argsText: event.target.value })}
            />
          </label>
        </>
      ) : (
        <>
          <label className="settings-extension-field">
            <span>{t('extensions.url')}</span>
            <Input
              value={draft.url}
              disabled={busy}
              onChange={(event) => onChange({ ...draft, url: event.target.value })}
              required
            />
          </label>
          <label className="settings-extension-field">
            <span>{t('extensions.authentication')}</span>
            <select
              className="settings-extension-select"
              value={draft.authKind}
              disabled={busy}
              onChange={(event) =>
                onChange({ ...draft, authKind: event.target.value as McpAuthKind })
              }
            >
              <option value="none">{t('extensions.authNone')}</option>
              <option value="bearer">{t('extensions.authBearer')}</option>
              <option value="oauth">{t('extensions.authOauth')}</option>
            </select>
          </label>
          {draft.authKind === 'bearer' ? (
            <label className="settings-extension-field">
              <span>{t('extensions.tokenEnv')}</span>
              <Input
                value={draft.tokenEnv}
                disabled={busy}
                onChange={(event) => onChange({ ...draft, tokenEnv: event.target.value })}
                required
              />
            </label>
          ) : null}
        </>
      )}
      <div className="settings-extension-form-actions">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>
          {t('extensions.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {t('extensions.saveServer')}
        </Button>
      </div>
    </form>
  );
}
