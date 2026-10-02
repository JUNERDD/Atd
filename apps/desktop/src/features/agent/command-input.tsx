import type { RunPolicy } from '../../client/agent/run-policy';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, FileText, Paperclip, Shield, X } from 'lucide-react';
import { useHotkeys } from 'react-hotkeys-hook';
import { Button } from '@atd/ui/components/button';
import { Kbd, KbdGroup } from '@atd/ui/components/kbd';
import { Spinner } from '@atd/ui/components/spinner';
import { isComposingKey } from '@atd/ui/lib/ime';
import { Label } from '@atd/ui/components/label';
import { Textarea } from '@atd/ui/components/textarea';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import type { PreparedCommand } from '../../client/agent/bridge';
import type { TaskInput } from '../../client/agent/task-schema';
import { missingScreenshot, screenshotOf } from '../../client/agent/screenshot-input';
import { ParameterField } from '../commands/parameter-field';
import { agentApi } from './use-agent';
import { showErrorToast } from '../../components/toast-store';
import { useOverlayFooter } from '../../components/use-overlay-footer';
import { acceleratorToHotkey, shortcutKeys } from '../../lib/shortcuts';
import { isImageMime } from '@atd/agent-contracts';
import { ResourceImage } from './resource-image';
import { ScreenshotField } from './screenshot-field';
import { VisionNotice } from './vision-notice';
import type { Connection, ModelReference } from '../../client/providers/schema';

/** Runs the command from anywhere in the form, like a sheet's default button. */
const RUN_SHORTCUT = 'CommandOrControl+Enter';
const SCREENSHOT_HINT_ID = 'command-screenshot-hint';

export function CommandInput({
  prepared,
  onChange,
  onRun,
  onOpenSettings,
  pending,
  policy,
  runLabel: customRunLabel,
  connections,
  model,
}: {
  runLabel?: string;
  policy: RunPolicy;
  connections: Connection[];
  /** The model the run would use, resolved as the panel resolves it for the run. */
  model: ModelReference | null;
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
  // A screenshot command runs with an image only; the field below says so while Run is off.
  const needsScreenshot = missingScreenshot(input);
  const shot = screenshotOf(input);
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
  const platform = window.desktop?.platform ?? 'web';
  useHotkeys(
    acceleratorToHotkey(RUN_SHORTCUT, platform),
    () => void run(),
    {
      delimiter: '|',
      useKey: false,
      enableOnFormTags: true,
      preventDefault: true,
      enabled: (event) => !event.repeat && !pending && !needsScreenshot,
      ignoreEventWhen: (event) => event.defaultPrevented || isComposingKey(event),
    },
    [pending, needsScreenshot, onRun],
  );
  return (
    <>
      <ScrollArea
        className="panel-content"
        viewportClassName="overlay-footer-fade"
        gutter="none"
        scrollShadow
      >
        <section className="panel-content-body command-preparation" aria-label={t('input.label')}>
          {/* The description says what the command will do, so it wraps instead of truncating;
              only an unusually long one is clamped, with the full text on hover. */}
          <p
            className="line-clamp-3 text-sm text-pretty text-muted-foreground"
            title={command.description}
          >
            {command.description}
          </p>
          {command.input.source === 'screenshot' && (
            <ScreenshotField input={input} onChange={onChange} hintId={SCREENSHOT_HINT_ID} />
          )}
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
              <ScrollArea className="panel-text-scroll" viewportClassName="max-h-[inherit]">
                <Textarea
                  id="command-text"
                  className="min-h-24 overflow-hidden"
                  data-panel-autofocus="true"
                  value={input.text}
                  maxLength={100000}
                  placeholder={t('input.textPlaceholder')}
                  // Edited text is no longer the captured selection or clipboard; the screenshot
                  // stays the input's image.
                  onChange={(event) =>
                    onChange({
                      ...input,
                      text: event.target.value,
                      source: input.source === 'screenshot' ? 'screenshot' : 'manual',
                    })
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
                  size="sm"
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
                  <Paperclip />
                  {t('input.attachFiles')}
                </Button>
              </div>
              {input.files
                .filter((file) => file.id !== shot?.id)
                .map((file) => (
                  <div className="flex items-center gap-2 text-sm" key={file.id}>
                    {isImageMime(file.type) ? (
                      <ResourceImage file={file} variant="icon" />
                    ) : (
                      <FileText size={16} className="shrink-0 text-muted-foreground" />
                    )}
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
              <VisionNotice files={input.files} connections={connections} model={model} />
            </div>
          )}
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
          <div className="run-policy">
            <p>
              <Shield size={14} aria-hidden="true" />
              {policy.tools.length
                ? t('input.toolsAskFirst', { n: policy.tools.length })
                : t('input.noFileTools')}
            </p>
            <p>
              <Brain size={14} aria-hidden="true" />
              {!policy.memory ? t('input.memoryOff') : t('input.memoryOn')}
            </p>
          </div>
        </section>
      </ScrollArea>
      <footer ref={footerRef} className="command-run-footer overlay-footer">
        <div className="command-run-actions">
          <Button variant="glass" onClick={onOpenSettings}>
            {t('input.commandSettings')}
          </Button>
          <Button
            disabled={pending || needsScreenshot}
            aria-describedby={needsScreenshot ? SCREENSHOT_HINT_ID : undefined}
            onClick={() => void run()}
          >
            {pending ? (
              <>
                <Spinner />
                {t('input.starting')}
              </>
            ) : (
              <>
                {runLabel}
                <KbdGroup aria-hidden="true">
                  {shortcutKeys(RUN_SHORTCUT, platform).map((key) => (
                    <Kbd key={key} className="run-shortcut-key">
                      {key}
                    </Kbd>
                  ))}
                </KbdGroup>
              </>
            )}
          </Button>
        </div>
      </footer>
    </>
  );
}
