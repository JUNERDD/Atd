import { useMemo, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  clampSupportedThinkingLevel,
  MAX_MODEL_ALIAS_NAME_LENGTH,
  supportedModelThinkingLevels,
  type RunContextChoice,
} from '@atd/agent-contracts';
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
import { Switch } from '@atd/ui/components/switch';
import { isComposingKey } from '@atd/ui/lib/ime';
import type {
  Connection,
  ModelAlias,
  ModelAliasDraft,
  ModelReference,
  ModelThinkingLevel,
} from '../../client/providers/schema';
import { messageOf } from '../../lib/errors';
import { ModelConfigPopover } from './model-config-popover';

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
  const fallbackRef: ModelReference | null =
    pick && pickModel ? { connectionId: pick.connectionId, modelId: pickModel } : null;
  const [name, setName] = useState(alias?.name ?? '');
  const [reference, setReference] = useState<ModelReference | null>(() =>
    alias ? { connectionId: alias.connectionId, modelId: alias.modelId } : fallbackRef,
  );
  const [contextChoice, setContextChoice] = useState<RunContextChoice | undefined>(
    () => alias?.contextChoice,
  );
  const [thinkingLevel, setThinkingLevel] = useState<ModelThinkingLevel | undefined>(
    () => alias?.thinkingLevel,
  );
  const [makeDefault, setMakeDefault] = useState(Boolean(alias && defaultAliasId === alias.id));
  const [nameError, setNameError] = useState('');
  const [submitError, setSubmitError] = useState('');

  const modelConnections = useMemo(() => [...connections], [connections]);
  const selectedConnection = connections.find((c) => c.connectionId === reference?.connectionId);
  const selectedModel = selectedConnection?.catalog.find((m) => m.id === reference?.modelId);

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

    const savedThinkingLevel =
      thinkingLevel && selectedModel
        ? clampSupportedThinkingLevel(supportedModelThinkingLevels(selectedModel), thinkingLevel)
        : thinkingLevel;
    const draft: ModelAliasDraft = {
      name: trimmed,
      connectionId: reference.connectionId,
      modelId: reference.modelId,
      ...(contextChoice ? { contextChoice } : {}),
      ...(savedThinkingLevel ? { thinkingLevel: savedThinkingLevel } : {}),
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
    }
    if (savedOk) onClose();
    else onSubmittingChange(false);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t(alias ? 'aliases.dialog.editTitle' : 'aliases.dialog.createTitle')}
        </DialogTitle>
        <DialogDescription className="text-pretty whitespace-normal">
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
            <Label>{t('aliases.dialog.model')}</Label>
            <ModelConfigPopover
              connections={modelConnections}
              model={reference}
              disabled={submitting || (!usable.length && !reference)}
              thinkingLevel={thinkingLevel ?? selectedConnection?.defaultThinkingLevel}
              draftContextChoice={contextChoice}
              hideDraftContextNote
              onModelChange={(next) => {
                setReference(next);
                setContextChoice(undefined);
                setThinkingLevel(undefined);
              }}
              onContextChoiceChange={setContextChoice}
              onThinkingLevelChange={setThinkingLevel}
            />
            {contextChoice && (
              <div className="flex items-center justify-between gap-2">
                <p
                  id="model-alias-context-note"
                  className="text-xs text-pretty break-normal text-muted-foreground"
                >
                  {t('aliases.dialog.contextOwn')}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="shrink-0"
                  disabled={submitting}
                  aria-describedby="model-alias-context-note"
                  onClick={() => setContextChoice(undefined)}
                >
                  {t('aliases.dialog.resetInherited')}
                </Button>
              </div>
            )}
            {thinkingLevel && (
              <div className="flex items-center justify-between gap-2">
                <p
                  id="model-alias-effort-note"
                  className="text-xs text-pretty break-normal text-muted-foreground"
                >
                  {t('aliases.dialog.effortOwn')}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="shrink-0"
                  disabled={submitting}
                  aria-describedby="model-alias-effort-note"
                  onClick={() => setThinkingLevel(undefined)}
                >
                  {t('aliases.dialog.resetInherited')}
                </Button>
              </div>
            )}
            {!contextChoice && !thinkingLevel && (
              <p className="text-xs text-pretty break-normal text-muted-foreground">
                {t('aliases.dialog.inheritDefaults')}
              </p>
            )}
          </div>
          <div className="model-alias-dialog-toggle">
            <div className="model-alias-dialog-toggle-copy">
              <Label htmlFor="model-alias-default">{t('aliases.dialog.makeDefault')}</Label>
              <p className="text-xs text-pretty break-normal text-muted-foreground">
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
    </>
  );
}

/** Dialog for creating or editing a named 4-tuple model alias. */
export function ModelAliasDialog(
  props: AliasDialogProps & { open: boolean; onOpenChange: (open: boolean) => void },
) {
  const { open, onOpenChange, ...bodyProps } = props;
  const [submitting, setSubmitting] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const [session, setSession] = useState(0);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSubmitting(false);
      setSession((n) => n + 1);
    }
  }
  const close = () => onOpenChange(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
      }}
    >
      <DialogContent
        material="backdrop"
        className="panel-dialog"
        onInteractOutside={(event) => submitting && event.preventDefault()}
        onEscapeKeyDown={(event) => submitting && event.preventDefault()}
      >
        <AliasDialogBody
          key={`${session}:${props.alias?.id ?? 'new'}`}
          {...bodyProps}
          submitting={submitting}
          onSubmittingChange={setSubmitting}
          onClose={close}
        />
      </DialogContent>
    </Dialog>
  );
}
