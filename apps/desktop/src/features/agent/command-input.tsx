import type { RunPolicy } from '../../../electron/agent/run-policy';
import { TaskPolicyControl } from './task-policy';
import { useState } from 'react';
import { Brain, FileText, Shield, X } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Label } from '@ai/ui/components/label';
import { Textarea } from '@ai/ui/components/textarea';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ai/ui/components/dialog';
import type { PreparedCommand } from '../../../electron/agent/bridge';
import type { TaskInput, RunSnapshot } from '../../../electron/agent/task-schema';
import { ParameterField } from '../commands/parameter-field';
import { agentApi, messageOf } from './use-agent';

export function CommandInput({
  prepared,
  onChange,
  onRun,
  pending,
  onReload,
  policy,
  onPolicyChange,
  runLabel = 'Run',
}: {
  runLabel?: string;
  policy: RunPolicy;
  onPolicyChange?: (policy: RunPolicy) => void;
  prepared: PreparedCommand;
  onChange: (input: TaskInput) => void;
  onRun: () => Promise<void>;
  pending: boolean;
  onReload?: () => Promise<void>;
}) {
  const { command, input } = prepared;
  const [editing, setEditing] = useState(!input.text.trim() && command.input.source !== 'none');
  const [error, setError] = useState(prepared.notice);
  const [review, setReview] = useState<RunSnapshot | null>(null);
  const [validate, setValidate] = useState(false);
  async function run() {
    setValidate(true);
    setError('');
    try {
      await onRun();
    } catch (error) {
      setError(messageOf(error));
    }
  }
  async function preview() {
    setValidate(true);
    setError('');
    try {
      setReview(await agentApi().preview(input, command, policy));
    } catch (error) {
      setError(messageOf(error));
    }
  }
  async function capture(source: 'selection' | 'clipboard') {
    try {
      const captured = await agentApi().capture(source);
      onChange({ ...input, [source]: captured.text, ...(input.source === source ? captured : {}) });
      setError('');
    } catch (error) {
      setError(messageOf(error));
    }
  }
  return (
    <>
      <ScrollArea className="panel-content">
        <section className="panel-content-body command-preparation" aria-label="Command input">
          <p className="truncate text-sm text-muted-foreground" title={command.description}>
            {command.description}
          </p>
          {(command.input.source !== 'none' || input.text) && (
            <div className="settings-field">
              <Label htmlFor="command-text">
                {input.source === 'selection'
                  ? 'Selected text'
                  : input.source === 'clipboard'
                    ? 'Clipboard text'
                    : 'Input'}
                {command.input.required ? ' *' : ''}
              </Label>
              {editing ? (
                <ScrollArea className="panel-text-scroll" viewportClassName="text-preview-viewport">
                  <Textarea
                    id="command-text"
                    className="min-h-24 overflow-hidden"
                    value={input.text}
                    maxLength={100000}
                    placeholder="Enter text to use with this command…"
                    onChange={(event) =>
                      onChange({ ...input, text: event.target.value, source: 'manual' })
                    }
                  />
                </ScrollArea>
              ) : (
                <ScrollArea className="input-preview" viewportClassName="text-preview-viewport">
                  <div>{input.text}</div>
                </ScrollArea>
              )}
              {input.capturedAt && input.source !== 'manual' && (
                <span className="text-xs text-muted-foreground">
                  Captured {new Date(input.capturedAt).toLocaleTimeString()}
                </span>
              )}
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
                <Label>Files</Label>
                <Button
                  variant="outline"
                  onClick={() => {
                    void agentApi()
                      .chooseFiles()
                      .then((files) => {
                        if (input.files.length + files.length > 10)
                          throw new Error('Attach at most 10 files.');
                        onChange({ ...input, files: [...input.files, ...files] });
                      })
                      .catch((error) => setError(messageOf(error)));
                  }}
                >
                  Attach files
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
                    aria-label={`Remove ${file.name}`}
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
          <div className="flex flex-wrap gap-2">
            {(['selection', 'clipboard'] as const)
              .filter((source) => command.input[source])
              .map((source) => (
                <Button
                  key={source}
                  variant="outline"
                  size="xs"
                  onClick={() => void capture(source)}
                >
                  {source === 'selection' ? 'Use captured selection' : 'Refresh clipboard'}
                </Button>
              ))}
          </div>
          <div className="run-policy">
            <p>
              <Shield size={16} />
              {policy.tools.length
                ? `${policy.tools.length} tools · Ask first`
                : 'No file or terminal tools'}
            </p>
            <p>
              <Brain size={16} />
              {!policy.memory
                ? 'Memory off for this task'
                : 'Memory on · Learning follows settings'}
            </p>
          </div>
          {Object.keys(input.arguments)
            .filter((key) => !command.parameters.some((parameter) => parameter.key === key))
            .map((key) => (
              <div key={key} className="flex items-center gap-2 text-xs text-destructive">
                <span className="flex-1">
                  Parameter {key} is no longer defined. Saved value: {String(input.arguments[key])}
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
                  Remove value
                </Button>
              </div>
            ))}
        </section>
      </ScrollArea>
      {error && (
        <ScrollArea className="command-input-feedback" viewportClassName="text-preview-viewport">
          <div className="command-input-feedback-body">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            {onReload && (
              <Button
                variant="outline"
                className="self-start"
                onClick={() => {
                  void onReload()
                    .then(() => setError('Latest command loaded. Review the retained input.'))
                    .catch((error) => setError(messageOf(error)));
                }}
              >
                Load latest command
              </Button>
            )}
          </div>
        </ScrollArea>
      )}
      <footer className="command-run-footer">
        <div className="command-run-tools">
          <Button variant="ghost" onClick={() => void preview()}>
            Review
          </Button>
          {onPolicyChange && <TaskPolicyControl value={policy} onChange={onPolicyChange} />}
        </div>
        <div className="command-run-actions">
          <Button variant="outline" onClick={() => setEditing((value) => !value)}>
            {editing ? 'Done editing' : 'Change input'}
          </Button>
          <Button disabled={pending} onClick={() => void run()}>
            {pending ? 'Starting…' : runLabel}
          </Button>
        </div>
      </footer>
      <Dialog
        open={Boolean(review)}
        onOpenChange={(open) => {
          if (!open) setReview(null);
        }}
      >
        <DialogContent className="panel-dialog">
          <DialogHeader>
            <DialogTitle>Review before running</DialogTitle>
            <DialogDescription
              className="truncate"
              title={`${command.name} · Version ${command.revision}`}
            >
              {`${command.name} · Version ${command.revision}`}
            </DialogDescription>
          </DialogHeader>
          {review && (
            <ScrollArea className="panel-dialog-scroll">
              <div className="panel-dialog-body">
                <p
                  className="truncate text-sm"
                  title={`${review.model.modelId} · ${review.tools.join(', ') || 'No tools'} · Memory ${review.memory ? 'on' : 'off'}`}
                >
                  {review.model.modelId} · {review.tools.join(', ') || 'No tools'} · Memory{' '}
                  {review.memory ? 'on' : 'off'}
                </p>
                <Label>Expanded instructions</Label>
                <ScrollArea className="review-text" viewportClassName="text-preview-viewport">
                  <pre>{review.instructions}</pre>
                </ScrollArea>
                <Label>Captured sources</Label>
                <ScrollArea className="review-text" viewportClassName="text-preview-viewport">
                  <pre>
                    {input.text}
                    {input.selection && `\n\nSelection:\n${input.selection}`}
                    {input.clipboard && `\n\nClipboard:\n${input.clipboard}`}
                  </pre>
                </ScrollArea>
              </div>
            </ScrollArea>
          )}
          {review && (
            <div className="panel-dialog-actions">
              <Button
                onClick={() => {
                  setReview(null);
                  void run();
                }}
                disabled={pending}
              >
                {runLabel === 'Run' ? 'Run command' : runLabel}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
