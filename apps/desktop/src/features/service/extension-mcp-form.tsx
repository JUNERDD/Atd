import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import { Textarea } from '@ai/ui/components/textarea';
import { FieldHint } from '../../components/field-hint';
import type {
  McpAuthKind,
  McpDraft,
  McpDraftField,
  McpDraftProblems,
  McpTransport,
} from './extension-mcp-draft';

const TRANSPORTS: readonly McpTransport[] = ['stdio', 'streamable-http', 'sse'];
const AUTH_KINDS: readonly McpAuthKind[] = ['none', 'bearer', 'oauth'];

function isTransport(value: string): value is McpTransport {
  return TRANSPORTS.some((transport) => transport === value);
}

function isAuthKind(value: string): value is McpAuthKind {
  return AUTH_KINDS.some((kind) => kind === value);
}

/** Control ids; a problem's message is `<id>-message`, which the control names as its description. */
const FIELD_ID: Record<McpDraftField | 'transport' | 'auth', string> = {
  serverId: 'mcp-server-id',
  transport: 'mcp-transport',
  command: 'mcp-command',
  args: 'mcp-arguments',
  url: 'mcp-url',
  auth: 'mcp-auth',
  tokenEnv: 'mcp-token-env',
};

/**
 * One labelled control. The label row and the control stack are the field's only two children,
 * so parallel fields keep their shared label and control tracks (`aligned-fields`) while a
 * message grows below the control.
 */
function McpField({
  id,
  label,
  hint,
  message,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  /** An inline problem (`error`) or a note about the current choice. */
  message?: string;
  error?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="settings-field">
      <div className="flex min-w-0 items-center gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        {hint ? <FieldHint text={hint} /> : null}
      </div>
      <div className="settings-field">
        {children}
        {message ? (
          <p
            id={`${id}-message`}
            className={error ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}
            role={error ? 'alert' : undefined}
          >
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The connection fields shared by the add and details pages: id and transport, then the command
 * and arguments of a local process or the URL and authentication of a remote server. Problems
 * show under their control once the page reports them.
 */
export function McpConnectionFields({
  draft,
  problems,
  idReadOnly,
  onChange,
}: {
  draft: McpDraft;
  problems: McpDraftProblems;
  /** An existing server keeps its id: the catalog and its sign-in are keyed by it. */
  idReadOnly: boolean;
  onChange: (next: McpDraft) => void;
}) {
  const { t } = useTranslation('settings');
  const problem = (field: McpDraftField) => {
    const key = problems[field];
    return key ? t(`extensions.mcpPage.errors.${key}`) : undefined;
  };
  /** Wires a control to its problem: invalid state plus the message as its description. */
  const invalid = (field: McpDraftField) =>
    problems[field]
      ? { 'aria-invalid': true, 'aria-describedby': `${FIELD_ID[field]}-message` }
      : {};
  const transportNote = {
    stdio: t('extensions.mcpPage.transportStdioHint'),
    'streamable-http': t('extensions.mcpPage.transportHttpHint'),
    sse: t('extensions.mcpPage.transportSseHint'),
  }[draft.transport];
  return (
    <>
      <div className="field-columns aligned-fields">
        <McpField
          id={FIELD_ID.serverId}
          label={t('extensions.serverId')}
          hint={idReadOnly ? undefined : t('extensions.mcpPage.serverIdHint')}
          message={problem('serverId')}
          error
        >
          <Input
            id={FIELD_ID.serverId}
            value={draft.serverId}
            maxLength={128}
            readOnly={idReadOnly}
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('extensions.mcpPage.serverIdPlaceholder')}
            onChange={(event) => onChange({ ...draft, serverId: event.target.value })}
            {...invalid('serverId')}
          />
        </McpField>
        <McpField id={FIELD_ID.transport} label={t('extensions.transport')} message={transportNote}>
          <Select
            value={draft.transport}
            onValueChange={(value) => {
              if (isTransport(value)) onChange({ ...draft, transport: value });
            }}
          >
            <SelectTrigger id={FIELD_ID.transport} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stdio">{t('extensions.mcpPage.transportStdio')}</SelectItem>
              <SelectItem value="streamable-http">
                {t('extensions.mcpPage.transportHttp')}
              </SelectItem>
              <SelectItem value="sse">{t('extensions.mcpPage.transportSse')}</SelectItem>
            </SelectContent>
          </Select>
        </McpField>
      </div>
      {draft.transport === 'stdio' ? (
        <>
          <McpField
            id={FIELD_ID.command}
            label={t('extensions.command')}
            message={problem('command')}
            error
          >
            <Input
              id={FIELD_ID.command}
              className="font-mono"
              value={draft.command}
              maxLength={1024}
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('extensions.mcpPage.commandPlaceholder')}
              onChange={(event) => onChange({ ...draft, command: event.target.value })}
              {...invalid('command')}
            />
          </McpField>
          <McpField
            id={FIELD_ID.args}
            label={t('extensions.arguments')}
            hint={t('extensions.mcpPage.argumentsHint')}
            message={problem('args')}
            error
          >
            <Textarea
              id={FIELD_ID.args}
              className="font-mono"
              value={draft.argsText}
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('extensions.mcpPage.argumentsPlaceholder')}
              onChange={(event) => onChange({ ...draft, argsText: event.target.value })}
              {...invalid('args')}
            />
          </McpField>
        </>
      ) : (
        <>
          <McpField id={FIELD_ID.url} label={t('extensions.url')} message={problem('url')} error>
            <Input
              id={FIELD_ID.url}
              type="url"
              className="font-mono"
              value={draft.url}
              maxLength={2048}
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('extensions.mcpPage.urlPlaceholder')}
              onChange={(event) => onChange({ ...draft, url: event.target.value })}
              {...invalid('url')}
            />
          </McpField>
          <div className="field-columns aligned-fields">
            <McpField
              id={FIELD_ID.auth}
              label={t('extensions.authentication')}
              message={draft.authKind === 'oauth' ? t('extensions.mcpPage.oauthHint') : undefined}
            >
              <Select
                value={draft.authKind}
                onValueChange={(value) => {
                  if (isAuthKind(value)) onChange({ ...draft, authKind: value });
                }}
              >
                <SelectTrigger id={FIELD_ID.auth} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('extensions.authNone')}</SelectItem>
                  <SelectItem value="bearer">{t('extensions.authBearer')}</SelectItem>
                  <SelectItem value="oauth">{t('extensions.authOauth')}</SelectItem>
                </SelectContent>
              </Select>
            </McpField>
            {draft.authKind === 'bearer' ? (
              <McpField
                id={FIELD_ID.tokenEnv}
                label={t('extensions.tokenEnv')}
                hint={t('extensions.mcpPage.tokenEnvHint')}
                message={problem('tokenEnv')}
                error
              >
                <Input
                  id={FIELD_ID.tokenEnv}
                  className="font-mono"
                  value={draft.tokenEnv}
                  maxLength={256}
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('extensions.mcpPage.tokenEnvPlaceholder')}
                  onChange={(event) => onChange({ ...draft, tokenEnv: event.target.value })}
                  {...invalid('tokenEnv')}
                />
              </McpField>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}
