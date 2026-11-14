import { useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MAX_MODEL_ALIAS_NAME_LENGTH } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@atd/ui/components/dialog';
import { Input } from '@atd/ui/components/input';
import { Label } from '@atd/ui/components/label';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import { Switch } from '@atd/ui/components/switch';
import { isComposingKey } from '@atd/ui/lib/ime';
import type {
  Connection,
  ModelAlias,
  ModelAliasDraft,
  ModelThinkingLevel,
} from '../../client/providers/schema';
import { messageOf } from '../../lib/errors';
import {
  FALLBACK_LEVELS,
  buildContextOptions,
  decodeContext,
  decodeRef,
  encodeContext,
  encodeRef,
} from './model-alias-options';
import { useModelContexts } from './use-model-contexts';
import { useThinkingLevels } from './use-thinking-levels';

interface AliasDialogProps {
  alias: ModelAlias | null;
  aliases: readonly ModelAlias[];
  defaultAliasId: string | null;
  connections: readonly Connection[];
  defaultConnectionId: string | null;
}

function InlineError({ id, message }: { id?: string; message: string }) {
  if (!message) return null;
  return (
    <p id={id} className="settings-inline-error" role="alert">
      <CircleAlert aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

function AliasDialogBody(
  props: AliasDialogProps & {
    submitting: boolean;
    onSubmittingChange: (submitting: boolean) => void;
    onClose: () => void;
  },
) {
  const {
    alias,
    aliases,
    defaultAliasId,
    connections,
    defaultConnectionId,
    submitting,
    onSubmittingChange,
    onClose,
  } = props;
  const { t } = useTranslation('providers');
  const bridge = window.desktop?.settings.providers;
  const usable = connections.filter((c) => c.connected && c.catalog.length > 0);
  const pick = usable.find((c) => c.connectionId === defaultConnectionId) ?? usable[0];
  const pickModel = pick?.defaultModel || pick?.catalog[0]?.id || '';
  const fallbackRef = pick && pickModel ? encodeRef(pick.connectionId, pickModel) : '';
  const [name, setName] = useState(alias?.name ?? '');
  const [modelValue, setModelValue] = useState(
    alias ? encodeRef(alias.connectionId, alias.modelId) : fallbackRef,
  );
  const [contextKey, setContextKey] = useState(() => encodeContext(alias?.contextChoice));
  const [thinkingKey, setThinkingKey] = useState<string>(alias?.thinkingLevel ?? 'default');
  const [makeDefault, setMakeDefault] = useState(Boolean(alias && defaultAliasId === alias.id));
  const [nameError, setNameError] = useState('');
  const [submitError, setSubmitError] = useState('');

  const reference = decodeRef(modelValue);
  const selectedConnection = connections.find((c) => c.connectionId === reference?.connectionId);
  const selectedModel = selectedConnection?.catalog.find((m) => m.id === reference?.modelId);
  const contexts = useModelContexts(reference, selectedConnection);
  const levels = useThinkingLevels(reference, selectedConnection);

  const currentInUsable = Boolean(selectedConnection?.connected && selectedModel);
  const contextOptions = buildContextOptions(contexts, contextKey, t);
  const fallbackLevels = selectedModel?.reasoning ? FALLBACK_LEVELS : [];
  const baseLevels = levels.levels.length ? levels.levels : fallbackLevels;
  const keptEffort = thinkingKey as ModelThinkingLevel;
  const levelValues =
    thinkingKey !== 'default' && !baseLevels.includes(keptEffort)
      ? [...baseLevels, keptEffort]
      : baseLevels;
  const defaultLevelName = t(`thinkingLevels.levels.${levels.defaultLevel}`);
  const defaultEffortLabel =
    !levels.loading && levels.levels.length > 0
      ? t('aliases.dialog.modelDefaultLevel', { level: defaultLevelName })
      : t('modelConfig.modelDefault');
  const effortOptions = [
    { value: 'default', label: defaultEffortLabel },
    ...levelValues.map((level) => ({ value: level, label: t(`thinkingLevels.levels.${level}`) })),
  ];

  async function save() {
    if (submitting || !bridge) return;
    const trimmed = name.trim();
    const lower = trimmed.toLowerCase();
    if (!trimmed) return setNameError(t('aliases.dialog.nameRequired'));
    if (trimmed.length > MAX_MODEL_ALIAS_NAME_LENGTH) {
      return setNameError(t('aliases.dialog.nameTooLong', { max: MAX_MODEL_ALIAS_NAME_LENGTH }));
    }
    if (aliases.some((i) => i.id !== alias?.id && i.name.trim().toLowerCase() === lower)) {
      return setNameError(t('aliases.dialog.nameDuplicate'));
    }
    if (!reference) return setSubmitError(t('aliases.dialog.noModel'));

    const contextChoice = decodeContext(contextKey);
    const thinkingLevel = thinkingKey !== 'default' ? keptEffort : undefined;
    const draft: ModelAliasDraft = {
      name: trimmed,
      connectionId: reference.connectionId,
      modelId: reference.modelId,
      ...(contextChoice ? { contextChoice } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    };
    setNameError('');
    setSubmitError('');
    onSubmittingChange(true);
    let savedOk = false;
    try {
      const saved = alias
        ? await bridge.updateAlias(alias.id, draft)
        : await bridge.createAlias(draft);
      const wasDefault = Boolean(alias && defaultAliasId === saved.id);
      if (makeDefault && defaultAliasId !== saved.id) await bridge.setDefaultAlias(saved.id);
      else if (!makeDefault && wasDefault) await bridge.setDefaultAlias(null);
      savedOk = true;
    } catch (reason) {
      setSubmitError(messageOf(reason));
    } finally {
      onSubmittingChange(false);
    }
    if (savedOk) onClose();
  }

  return (
    <DialogContent
      className="panel-dialog"
      onInteractOutside={(event) => submitting && event.preventDefault()}
      onEscapeKeyDown={(event) => submitting && event.preventDefault()}
    >
      <DialogHeader>
        <DialogTitle>
          {t(alias ? 'aliases.dialog.editTitle' : 'aliases.dialog.createTitle')}
        </DialogTitle>
        <DialogDescription className="whitespace-normal">
          {t('aliases.dialog.description')}
        </DialogDescription>
      </DialogHeader>
      <ScrollArea className="panel-dialog-scroll" gutter="stable" scrollShadow>
        <div className="panel-dialog-body overflow-x-clip">
          <div className="settings-field">
            <Label htmlFor="model-alias-name">{t('aliases.dialog.name')}</Label>
            <Input
              id="model-alias-name"
              value={name}
              maxLength={MAX_MODEL_ALIAS_NAME_LENGTH}
              placeholder={t('aliases.dialog.namePlaceholder')}
              disabled={submitting}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'model-alias-name-error' : undefined}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) setNameError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isComposingKey(event)) void save();
              }}
            />
            <InlineError id="model-alias-name-error" message={nameError} />
          </div>
          <div className="settings-field">
            <Label htmlFor="model-alias-model">{t('aliases.dialog.model')}</Label>
            <Select
              value={modelValue}
              disabled={submitting || (!usable.length && !modelValue)}
              onValueChange={(next) => {
                setModelValue(next);
                setContextKey('default');
                setThinkingKey('default');
              }}
            >
              <SelectTrigger id="model-alias-model" className="w-full">
                <SelectValue placeholder={t('aliases.dialog.noModel')} />
              </SelectTrigger>
              <SelectContent>
                {reference && !currentInUsable && (
                  <SelectItem value={modelValue}>
                    {t('aliases.dialog.unavailableOption', {
                      model: selectedModel?.name ?? reference.modelId,
                      connection: selectedConnection?.name ?? t('aliases.unavailableConnection'),
                    })}
                  </SelectItem>
                )}
                {usable.map((connection) => (
                  <SelectGroup key={connection.connectionId}>
                    <SelectLabel>{connection.name}</SelectLabel>
                    {connection.catalog.map((m) => (
                      <SelectItem key={m.id} value={encodeRef(connection.connectionId, m.id)}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          {[
            [
              'model-alias-context',
              t('aliases.dialog.contextWindow'),
              contextKey,
              submitting || contextOptions.length <= 1,
              setContextKey,
              contextOptions,
            ] as const,
            [
              'model-alias-effort',
              t('aliases.dialog.thinkingLevel'),
              thinkingKey,
              submitting || levelValues.length === 0,
              setThinkingKey,
              effortOptions,
            ] as const,
          ].map(([id, label, value, disabled, onChange, options]) => (
            <div key={id} className="settings-field">
              <Label htmlFor={id}>{label}</Label>
              <Select value={value} disabled={disabled} onValueChange={onChange}>
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          <div className="model-alias-dialog-toggle">
            <div className="model-alias-dialog-toggle-copy">
              <Label htmlFor="model-alias-default">{t('aliases.dialog.makeDefault')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('aliases.dialog.makeDefaultDescription')}
              </p>
            </div>
            <Switch
              id="model-alias-default"
              checked={makeDefault}
              disabled={submitting}
              onCheckedChange={setMakeDefault}
            />
          </div>
          <InlineError message={submitError} />
        </div>
      </ScrollArea>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={submitting} onClick={onClose}>
          {t('aliases.dialog.cancel')}
        </Button>
        <Button
          type="button"
          disabled={!bridge || submitting || !reference}
          aria-busy={submitting || undefined}
          onClick={() => void save()}
        >
          {submitting
            ? t('aliases.dialog.saving')
            : t(alias ? 'aliases.dialog.save' : 'aliases.dialog.create')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** Dialog for creating or editing a named 4-tuple model alias. */
export function ModelAliasDialog(
  props: AliasDialogProps & { open: boolean; onOpenChange: (open: boolean) => void },
) {
  const { open, onOpenChange, ...bodyProps } = props;
  const [submitting, setSubmitting] = useState(false);
  const close = () => onOpenChange(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
      }}
    >
      {open && (
        <AliasDialogBody
          key={props.alias?.id ?? 'new'}
          {...bodyProps}
          submitting={submitting}
          onSubmittingChange={setSubmitting}
          onClose={close}
        />
      )}
    </Dialog>
  );
}
