import type { RunPolicy } from '../../../electron/agent/run-policy';
import { TaskPolicyControl } from './task-policy';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, FileText, Shield, X } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Label } from '@ai/ui/components/label';
import { Textarea } from '@ai/ui/components/textarea';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import type { PreparedCommand } from '../../../electron/agent/bridge';
import type { TaskInput } from '../../../electron/agent/task-schema';
import { ParameterField } from '../commands/parameter-field';
import { agentApi } from './use-agent';
import { showErrorToast } from '../../components/toast-store';
import { useOverlayFooter } from '../../components/use-overlay-footer';

export function CommandInput({
  prepared,
  onChange,
  onRun,
  onOpenSettings,
  pending,
  policy,
  onPolicyChange,
  runLabel: customRunLabel,
}: {
  runLabel?: string;
  policy: RunPolicy;
  onPolicyChange?: (policy: RunPolicy) => void;
  prepared: PreparedCommand;
  onChange: (input: TaskInput) => void;
  onRun: () => Promise<unknown>;
  onOpenSettings: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation('panel');
  const footerRef = useOverlayFooter<HTMLElement>();
  const runLabel = customRunLabel ?? t('input.run');
  const { command, input } = prepared;
  const [validate, setValidate] = useState(false);
  useEffect(() => {
    if (prepared.notice) showErrorToast(prepared.notice);
  }, [prepared.notice]);
  async function run() {
    setValidate(true);
    try {
      await onRun();
    } catch (error) {
      showErrorToast(error);
    }
  }
  return (
    <>
      <ScrollArea className="panel-content" viewportClassName="overlay-footer-fade">
        <section className="panel-content-body command-preparation" aria-label={t('input.label')}>
          <p className="truncate text-sm text-muted-foreground" title={command.description}>
            {command.description}
          </p>
          {(command.input.source !== 'none' || input.text) && (
            <div className="settings-field">
              <Label htmlFor="command-text">
                {input.source === 'selection'
                  ? t('input.selectedText')
                  : input.source === 'clipboard'
                    ? t('input.clipboardText')
                    : t('input.text')}
                {command.input.required ? ' *' : ''}
              </Label>
              <ScrollArea className="panel-text-scroll" viewportClassName="text-preview-viewport">
                <Textarea
                  id="command-text"
                  className="min-h-24 overflow-hidden"
                  data-panel-autofocus="true"
                  value={input.text}
                  maxLength={100000}
                  placeholder={t('input.textPlaceholder')}
                  onChange={(event) =>
                    onChange({ ...input, text: event.target.value, source: 'manual' })
                  }
                />
              </ScrollArea>
            </div>
          )}
          {command.parameters.map((parameter) => (
            <ParameterField
              key={parameter.key}
              parameter={parameter}
              value={input.arguments[parameter.key]}
              validate={validate}
              onChange={(value) => {
                const values = { ...input.arguments };
                if (value === undefined) delete values[parameter.key];
                else values[parameter.key] = value;
                onChange({ ...input, arguments: values });
              }}
            />
          ))}
          {(command.input.files || input.files.length > 0) && (
            <div className="settings-field">
              <div className="flex items-center justify-between">
                <Label>{t('input.files')}</Label>
                <Button
                  variant="outline"
                  onClick={() => {
                    void agentApi()
                      .chooseFiles()
                      .then((files) => {
                        if (input.files.length + files.length > 10)
                          throw new Error(t('input.attachLimit'));
                        onChange({ ...input, files: [...input.files, ...files] });
                      })
                      .catch((error) => showErrorToast(error));
                  }}
                >
                  {t('input.attachFiles')}
                </Button>
              </div>
              {input.files.map((file) => (
                <div className="flex items-center gap-2 text-sm" key={file.id}>
                  <FileText size={16} />
                  <span className="min-w-0 flex-1 truncate" title={file.name}>
                    {file.name}
                  </span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t('input.removeFile', { name: file.name })}
                    onClick={() =>
                      onChange({
                        ...input,
                        files: input.files.filter((item) => item.id !== file.id),
                      })
                    }
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="run-policy">
            <p>
              <Shield size={16} />
              {policy.tools.length
                ? t('input.toolsAskFirst', { n: policy.tools.length })
                : t('input.noFileTools')}
            </p>
            <p>
              <Brain size={16} />
              {!policy.memory ? t('input.memoryOff') : t('input.memoryOn')}
            </p>
          </div>
          {Object.keys(input.arguments)
            .filter((key) => !command.parameters.some((parameter) => parameter.key === key))
            .map((key) => (
              <div key={key} className="flex items-center gap-2 text-xs text-destructive">
                <span className="flex-1">
                  {t('input.orphanParameter', {
                    key,
                    value: String(input.arguments[key]),
                  })}
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    const arguments_ = { ...input.arguments };
                    delete arguments_[key];
                    onChange({ ...input, arguments: arguments_ });
                  }}
                >
                  {t('input.removeValue')}
                </Button>
              </div>
            ))}
        </section>
      </ScrollArea>
      <footer ref={footerRef} className="command-run-footer overlay-footer">
        <div className="command-run-tools">
          {onPolicyChange && <TaskPolicyControl value={policy} onChange={onPolicyChange} />}
        </div>
        <div className="command-run-actions">
          <Button variant="outline" onClick={onOpenSettings}>
            {t('input.commandSettings')}
          </Button>
          <Button disabled={pending} onClick={() => void run()}>
            {pending ? t('input.starting') : runLabel}
          </Button>
        </div>
      </footer>
    </>
  );
}
