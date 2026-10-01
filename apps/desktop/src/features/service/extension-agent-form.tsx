import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@ai/ui/components/input';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@ai/ui/components/item';
import { Label } from '@ai/ui/components/label';
import { Switch } from '@ai/ui/components/switch';
import { Textarea } from '@ai/ui/components/textarea';
import { FieldHint } from '../../components/field-hint';
import { useSettingsUnsavedChanges } from '../settings/settings-unsaved-changes';
import {
  AGENT_CHECKED_FIELDS,
  AGENT_LIMITS,
  agentDraftErrors,
  agentInputOf,
  sameAgentDraft,
  withAgentTool,
  type AgentDraft,
  type AgentDraftError,
  type AgentInput,
} from './extension-agent-draft';
import { ROLE_TOOLS } from './extension-rows';

/** A field's inline problem under its control; the control names it through aria-describedby. */
function FieldError({ id, error }: { id: string; error: AgentDraftError | undefined }) {
  const { t } = useTranslation('settings');
  if (!error) return null;
  return (
    <p id={id} className="text-xs text-destructive" role="alert">
      {t(`extensions.agentPage.errors.${error}`)}
    </p>
  );
}

/** A field label with its tooltip hint, as the command editor pairs them. */
function HintedLabel({
  htmlFor,
  id,
  hint,
  children,
}: {
  htmlFor?: string;
  id?: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor} id={id}>
        {children}
      </Label>
      <FieldHint text={hint} />
    </div>
  );
}

/**
 * The markdown subagent form, composed like the command editor: name and description side by
 * side, the tool switches in the run-settings grid, then the model and the system prompt. It owns
 * the draft; the page's footer submits it through `formId`. Problems show once a submit was
 * tried and then follow the edits; a submit with problems focuses the first one instead of
 * saving. `takenNames` is null when editing, which fixes the name.
 */
export function AgentForm({
  formId,
  initial,
  takenNames,
  customized,
  disabled,
  onSubmit,
}: {
  formId: string;
  initial: AgentDraft;
  takenNames: readonly string[] | null;
  /** A Settings override replaces the file's tools in later runs. */
  customized: boolean;
  disabled: boolean;
  onSubmit: (input: AgentInput) => void;
}) {
  const { t } = useTranslation('settings');
  const id = useId();
  const [draft, setDraft] = useState(initial);
  // Leaving with edits asks first; the page leaves after a save without asking.
  useSettingsUnsavedChanges(!sameAgentDraft(draft, initial));
  const [attempted, setAttempted] = useState(false);
  const editing = takenNames === null;
  const errors = attempted ? agentDraftErrors(draft, takenNames) : {};
  const fieldId = (field: string) => `${id}-${field}`;
  const errorId = (field: string) => `${id}-${field}-error`;
  const invalid = (field: keyof typeof errors) => ({
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? errorId(field) : undefined,
  });

  return (
    <form
      id={formId}
      className="editor-fields"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        const problems = agentDraftErrors(draft, takenNames);
        const first = AGENT_CHECKED_FIELDS.find((field) => problems[field]);
        setAttempted(true);
        if (first) document.getElementById(fieldId(first))?.focus();
        else onSubmit(agentInputOf(draft));
      }}
    >
      <div className="field-columns aligned-fields">
        <div className="settings-field">
          {editing ? (
            <Label htmlFor={fieldId('name')}>{t('extensions.agentName')}</Label>
          ) : (
            <HintedLabel htmlFor={fieldId('name')} hint={t('extensions.agentPage.nameHint')}>
              {t('extensions.agentName')}
            </HintedLabel>
          )}
          <div className="settings-field">
            <Input
              id={fieldId('name')}
              value={draft.name}
              maxLength={AGENT_LIMITS.name}
              placeholder={editing ? undefined : t('extensions.agentPage.namePlaceholder')}
              disabled={disabled || editing}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              {...invalid('name')}
            />
            <FieldError id={errorId('name')} error={errors.name} />
          </div>
        </div>
        <div className="settings-field">
          <Label htmlFor={fieldId('description')}>{t('extensions.agentDescription')}</Label>
          <div className="settings-field">
            <Input
              id={fieldId('description')}
              value={draft.description}
              maxLength={AGENT_LIMITS.description}
              placeholder={t('extensions.agentPage.descriptionPlaceholder')}
              disabled={disabled}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              {...invalid('description')}
            />
            <FieldError id={errorId('description')} error={errors.description} />
          </div>
        </div>
      </div>
      <section className="settings-field" aria-labelledby={fieldId('tools')}>
        <HintedLabel id={fieldId('tools')} hint={t('extensions.agentPage.toolsHint')}>
          {t('extensions.agentTools')}
        </HintedLabel>
        <ItemGroup className="run-settings-tools">
          {ROLE_TOOLS.map((tool) => (
            <Item
              asChild
              key={tool}
              variant="outline"
              size="sm"
              className="grid grid-cols-[minmax(0,1fr)_auto]"
            >
              <li>
                <ItemContent>
                  <ItemTitle>{t(`extensions.agentPermissions.tools.${tool}.label`)}</ItemTitle>
                  <ItemDescription>
                    {t(`extensions.agentPermissions.tools.${tool}.description`)}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Switch
                    aria-label={t(`extensions.agentPermissions.tools.${tool}.label`)}
                    checked={draft.tools.includes(tool)}
                    disabled={disabled}
                    onCheckedChange={(on) => setDraft(withAgentTool(draft, tool, on))}
                  />
                </ItemActions>
              </li>
            </Item>
          ))}
        </ItemGroup>
        {customized ? (
          <p className="settings-field-note">{t('extensions.agentPage.toolsOverridden')}</p>
        ) : null}
      </section>
      <div className="settings-field">
        <HintedLabel htmlFor={fieldId('model')} hint={t('extensions.agentPage.modelHint')}>
          {t('extensions.agentModelOptional')}
        </HintedLabel>
        <Input
          id={fieldId('model')}
          value={draft.model}
          maxLength={AGENT_LIMITS.model}
          placeholder={t('extensions.agentTaskModel')}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setDraft({ ...draft, model: event.target.value })}
        />
      </div>
      <div className="settings-field">
        <Label htmlFor={fieldId('systemPrompt')}>{t('extensions.agentSystemPrompt')}</Label>
        <Textarea
          id={fieldId('systemPrompt')}
          value={draft.systemPrompt}
          rows={10}
          maxLength={AGENT_LIMITS.systemPrompt}
          placeholder={t('extensions.agentPage.systemPromptPlaceholder')}
          disabled={disabled}
          className="field-sizing-fixed resize-y"
          onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })}
          {...invalid('systemPrompt')}
        />
        <FieldError id={errorId('systemPrompt')} error={errors.systemPrompt} />
      </div>
    </form>
  );
}
