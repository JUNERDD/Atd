import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@atd/ui/components/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@atd/ui/components/input-group';
import type { McpDraft, McpDraftProblems } from './extension-mcp-draft';
import { McpField } from './extension-mcp-field';
import { MCP_FIELD_ID as FIELD_ID, useMcpProblems } from './extension-mcp-problems';

/** Text inputs here hold ids, URLs and secrets: no autocorrection or autofill. */
const PLAIN = { autoCapitalize: 'off', autoComplete: 'off', spellCheck: false } as const;

/**
 * The client secret. A stored secret shows as Set and stays kept until Replace opens an empty
 * field; Keep saved returns to the stored one, and an emptied field saves no secret. The service
 * keeps the value in the system credential store and never sends it back.
 */
function ClientSecretField({
  draft,
  secretSaved,
  problems,
  onChange,
}: {
  draft: McpDraft;
  secretSaved: boolean;
  problems: McpDraftProblems;
  onChange: (next: McpDraft) => void;
}) {
  const { t } = useTranslation('settings');
  const { problem, invalid } = useMcpProblems(problems);
  const inputRef = useRef<HTMLInputElement>(null);
  const keeping = draft.clientSecret === null;
  const setSecret = (clientSecret: string | null) => {
    onChange({ ...draft, clientSecret });
    // The same input switches mode, so it can take focus once the change renders.
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  return (
    <McpField
      id={FIELD_ID.clientSecret}
      label={t('extensions.mcpPage.clientSecret')}
      hint={t('extensions.mcpPage.clientSecretHint')}
      message={problem('clientSecret')}
      error
    >
      <InputGroup>
        <InputGroupInput
          ref={inputRef}
          id={FIELD_ID.clientSecret}
          type={keeping ? 'text' : 'password'}
          className="font-mono"
          value={draft.clientSecret ?? ''}
          readOnly={keeping}
          maxLength={8192}
          {...PLAIN}
          placeholder={
            keeping
              ? t('extensions.mcpPage.clientSecretSet')
              : secretSaved
                ? t('extensions.mcpPage.clientSecretReplacePlaceholder')
                : t('extensions.mcpPage.optionalPlaceholder')
          }
          onChange={(event) => onChange({ ...draft, clientSecret: event.target.value })}
          {...invalid('clientSecret')}
        />
        {secretSaved ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="button"
              variant="secondary"
              onClick={() => setSecret(keeping ? '' : null)}
            >
              {keeping
                ? t('extensions.mcpPage.clientSecretReplace')
                : t('extensions.mcpPage.clientSecretKeep')}
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </McpField>
  );
}

/**
 * The optional pre-registered OAuth client of a remote server: client id and name, secret and
 * fixed callback port, and the authorization server metadata URL that replaces discovery. Left
 * empty, the service registers a client itself.
 */
export function McpOAuthClientFields({
  draft,
  problems,
  secretSaved,
  onChange,
}: {
  draft: McpDraft;
  problems: McpDraftProblems;
  /** The stored record has a client secret the draft may keep. */
  secretSaved: boolean;
  onChange: (next: McpDraft) => void;
}) {
  const { t } = useTranslation('settings');
  const { problem, invalid } = useMcpProblems(problems);
  return (
    <>
      <p className="text-xs text-muted-foreground">{t('extensions.mcpPage.oauthSectionNote')}</p>
      <div className="field-columns aligned-fields">
        <McpField
          id={FIELD_ID.clientId}
          label={t('extensions.mcpPage.clientId')}
          message={problem('clientId')}
          error
        >
          <Input
            id={FIELD_ID.clientId}
            className="font-mono"
            value={draft.clientId}
            maxLength={512}
            {...PLAIN}
            placeholder={t('extensions.mcpPage.optionalPlaceholder')}
            onChange={(event) => onChange({ ...draft, clientId: event.target.value })}
            {...invalid('clientId')}
          />
        </McpField>
        <McpField
          id="mcp-client-name"
          label={t('extensions.mcpPage.clientName')}
          hint={t('extensions.mcpPage.clientNameHint')}
        >
          <Input
            id="mcp-client-name"
            value={draft.clientName}
            maxLength={256}
            {...PLAIN}
            placeholder={t('extensions.mcpPage.optionalPlaceholder')}
            onChange={(event) => onChange({ ...draft, clientName: event.target.value })}
          />
        </McpField>
      </div>
      <div className="field-columns aligned-fields">
        <ClientSecretField
          draft={draft}
          secretSaved={secretSaved}
          problems={problems}
          onChange={onChange}
        />
        <McpField
          id={FIELD_ID.callbackPort}
          label={t('extensions.mcpPage.callbackPort')}
          hint={t('extensions.mcpPage.callbackPortHint')}
          message={problem('callbackPort')}
          error
        >
          <Input
            id={FIELD_ID.callbackPort}
            className="font-mono"
            inputMode="numeric"
            value={draft.callbackPort}
            maxLength={5}
            {...PLAIN}
            placeholder={t('extensions.mcpPage.callbackPortPlaceholder')}
            onChange={(event) => onChange({ ...draft, callbackPort: event.target.value })}
            {...invalid('callbackPort')}
          />
        </McpField>
      </div>
      <McpField
        id={FIELD_ID.metadataUrl}
        label={t('extensions.mcpPage.metadataUrl')}
        hint={t('extensions.mcpPage.metadataUrlHint')}
        message={problem('metadataUrl')}
        error
      >
        <Input
          id={FIELD_ID.metadataUrl}
          type="url"
          className="font-mono"
          value={draft.metadataUrl}
          maxLength={2048}
          {...PLAIN}
          placeholder={t('extensions.mcpPage.metadataUrlPlaceholder')}
          onChange={(event) => onChange({ ...draft, metadataUrl: event.target.value })}
          {...invalid('metadataUrl')}
        />
      </McpField>
    </>
  );
}
