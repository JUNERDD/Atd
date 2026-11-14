import { useState, type FormEvent } from 'react';
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
import type {
  Connection,
  ModelAlias,
  ModelAliasDraft,
  ModelReference,
  ModelThinkingLevel,
  RunContextChoice,
} from '../../client/providers/schema';
import { messageOf } from '../../lib/errors';
import { formatContextWindow } from './context-window';
import { useModelContexts, type ModelContextState } from './use-model-contexts';
import { useThinkingLevels } from './use-thinking-levels';

type ProvidersT = ReturnType<typeof useTranslation<'providers'>>['t'];

interface AliasDialogProps {
  alias: ModelAlias | null;
  aliases: readonly ModelAlias[];
  defaultAliasId: string | null;
  connections: readonly Connection[];
  defaultConnectionId: string | null;
}

const FALLBACK_LEVELS: readonly ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high'];
const encodeRef = (connectionId: string, modelId: string) => `${connectionId}\n${modelId}`;

function decodeRef(value: string): ModelReference | null {
  const i = value.indexOf('\n');
  return i > 0 && i < value.length - 1
    ? { connectionId: value.slice(0, i), modelId: value.slice(i + 1) }
    : null;
}

function decodeContext(value: string): RunContextChoice | undefined {
  if (value === 'tier:standard') return { tier: 'standard' };
  if (value === 'tier:long') return { tier: 'long' };
  const tokens = value.startsWith('window:') ? Number(value.slice(7)) : NaN;
  return Number.isInteger(tokens) && tokens > 0 ? { contextWindow: tokens } : undefined;
}

function buildContextOptions(contexts: ModelContextState, contextKey: string, t: ProvidersT) {
  const items = [{ value: 'default', label: t('aliases.dialog.connectionDefault') }];
  const tiers = contexts.options.length === 2 ? contexts.options : [];
  const used = new Set(tiers.map((option) => option.contextWindow));
  for (const { tier, contextWindow } of tiers) {
    const key =
      tier === 'long' ? 'aliases.tuple.extendedContextSize' : 'aliases.tuple.standardContextSize';
    items.push({
      value: `tier:${tier}`,
      label: t(key, { size: formatContextWindow(contextWindow) }),
    });
  }
  for (const tokens of contexts.choices) {
    if (!used.has(tokens)) {
      items.push({ value: `window:${tokens}`, label: formatContextWindow(tokens) });
    }
  }
  if (contextKey !== 'default' && !items.some((item) => item.value === contextKey)) {
    const kept = decodeContext(contextKey);
    const label = !kept
      ? contextKey
      : 'tier' in kept
        ? t(
            kept.tier === 'long'
              ? 'aliases.tuple.extendedContext'
              : 'aliases.tuple.standardContext',
          )
        : t('aliases.dialog.customContextSize', { size: formatContextWindow(kept.contextWindow) });
    items.push({ value: contextKey, label });
  }
  return items;
}

function encodeContext(choice?: RunContextChoice): string {
  if (!choice) return 'default';
  return 'tier' in choice ? `tier:${choice.tier}` : `window:${choice.contextWindow}`;
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

function AliasDialogBody(props: AliasDialogProps & { onClose: () => void }) {
  const { alias, aliases, defaultAliasId, connections, defaultConnectionId, onClose } = props;
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
  const [submitting, setSubmitting] = useState(false);

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
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
    setSubmitting(true);
    try {
      const saved = alias
        ? await bridge.updateAlias(alias.id, draft)
        : await bridge.createAlias(draft);
      const wasDefault = Boolean(alias && defaultAliasId === saved.id);
      if (makeDefault && defaultAliasId !== saved.id) await bridge.setDefaultAlias(saved.id);
      else if (!makeDefault && wasDefault) await bridge.setDefaultAlias(null);
      onClose();
    } catch (reason) {
      setSubmitError(messageOf(reason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogContent
      onInteractOutside={(event) => submitting && event.preventDefault()}
      onEscapeKeyDown={(event) => submitting && event.preventDefault()}
    >
      <form className="flex flex-col gap-6" onSubmit={(event) => void handleSubmit(event)}>
        <DialogHeader>
          <DialogTitle>
            {t(alias ? 'aliases.dialog.editTitle' : 'aliases.dialog.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('aliases.dialog.description')}</DialogDescription>
        </DialogHeader>
        <div className="model-alias-dialog-fields">
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
        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={onClose}>
            {t('aliases.dialog.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={!bridge || submitting || !reference}
            aria-busy={submitting || undefined}
          >
            {submitting
              ? t('aliases.dialog.saving')
              : t(alias ? 'aliases.dialog.save' : 'aliases.dialog.create')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** Dialog for creating or editing a named 4-tuple model alias. */
export function ModelAliasDialog(
  props: AliasDialogProps & { open: boolean; onOpenChange: (open: boolean) => void },
) {
  const { open, onOpenChange, ...bodyProps } = props;
  const close = () => onOpenChange(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <AliasDialogBody key={props.alias?.id ?? 'new'} {...bodyProps} onClose={close} />}
    </Dialog>
  );
}
