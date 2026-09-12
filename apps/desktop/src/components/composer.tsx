import { useCallback, useEffect, useRef, useState } from 'react';
import { useHotkeys, type Options } from 'react-hotkeys-hook';
import { ArrowUp, Play, Plus, Square, X } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Textarea } from '@ai/ui/components/textarea';
import type { ProviderSettings, ShortcutBindings } from '../../electron/settings-contract';
import { DEFAULT_SHORTCUTS } from '../../electron/settings-contract';
import type { FileRef, RunStatus } from '../../electron/agent/task-schema';
import type { RunPolicy } from '../../electron/agent/run-policy';
import { isActive } from '../../electron/agent/task-schema';
import { IconButton } from './icon-button';
import { ComposerConfiguration } from './composer-configuration';
import { acceleratorToHotkey } from '../lib/shortcuts';
import { agentApi, messageOf } from '../features/agent/use-agent';
import './composer.css';

export interface ComposerDraft {
  text: string;
  files: FileRef[];
}
interface ComposerProps {
  policy: RunPolicy;
  onPolicyChange: (policy: RunPolicy) => void;
  draft: ComposerDraft;
  onChange: (draft: ComposerDraft) => void;
  onSubmit: () => Promise<void>;
  onStop?: () => Promise<void>;
  onContinue?: () => Promise<void>;
  status?: RunStatus;
  pending?: boolean;
  followup?: boolean;
  shortcuts?: ShortcutBindings;
  provider?: ProviderSettings;
  onOpenSettings: () => void;
}

export function Composer({
  draft,
  onChange,
  onSubmit,
  onStop,
  onContinue,
  status,
  pending = false,
  followup = false,
  shortcuts = DEFAULT_SHORTCUTS,
  provider,
  onOpenSettings,
  policy,
  onPolicyChange,
}: ComposerProps) {
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const hasContent = Boolean(draft.text.trim() || draft.files.length);
  const active = isActive(status);
  const continuing = status === 'stopped' && !hasContent;
  const label = active
    ? status === 'stopping'
      ? 'Stopping…'
      : status === 'queued'
        ? 'Cancel queued task'
        : 'Stop task'
    : continuing
      ? 'Continue task'
      : 'Send task';
  const disabled = pending || status === 'stopping' || (!active && !continuing && !hasContent);
  const platform = window.desktop?.platform ?? 'web';
  const expanded = draft.text.includes('\n') || draft.text.length > 90;
  const options: Options = {
    delimiter: '|',
    useKey: false,
    enableOnFormTags: ['textarea'],
    enabled: (event) => !event.repeat,
    ignoreEventWhen: (event) =>
      event.defaultPrevented || event.isComposing || event.keyCode === 229,
  };
  async function act() {
    if (disabled) return;
    setError('');
    try {
      if (active) await onStop?.();
      else if (continuing) await onContinue?.();
      else await onSubmit();
    } catch (error) {
      setError(messageOf(error));
    }
  }
  const sendRef = useHotkeys<HTMLTextAreaElement>(
    acceleratorToHotkey(shortcuts.sendMessage, platform),
    () => {
      if (!active) void act();
    },
    { ...options, preventDefault: true },
    [draft, disabled, active, continuing, onSubmit, onContinue],
  );
  const newLineRef = useHotkeys<HTMLTextAreaElement>(
    acceleratorToHotkey(shortcuts.newLine, platform),
    (event) => {
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) return;
      event.preventDefault();
      const input = textarea.current;
      if (!input) return;
      const { selectionStart: start, selectionEnd: end } = input;
      onChange({ ...draft, text: `${draft.text.slice(0, start)}\n${draft.text.slice(end)}` });
      requestAnimationFrame(() => textarea.current?.setSelectionRange(start + 1, start + 1));
    },
    options,
    [draft, onChange],
  );
  const ref = useCallback(
    (input: HTMLTextAreaElement | null) => {
      textarea.current = input;
      sendRef(input);
      newLineRef(input);
    },
    [sendRef, newLineRef],
  );
  useEffect(() => {
    textarea.current?.focus();
  }, []);
  async function choose() {
    setChoosing(true);
    setError('');
    try {
      const files = await agentApi().chooseFiles();
      if (draft.files.length + files.length > 10) throw new Error('Attach at most 10 files.');
      onChange({ ...draft, files: [...draft.files, ...files] });
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setChoosing(false);
    }
  }
  return (
    <footer className="panel-footer">
      <form
        className="composer"
        aria-label={followup ? 'Follow-up' : 'New task'}
        onSubmit={(event) => {
          event.preventDefault();
          if (!active) void act();
        }}
      >
        <div
          className="composer-surface"
          data-expanded={expanded}
          data-has-attachments={draft.files.length > 0}
        >
          <Textarea
            ref={ref}
            className="composer-input"
            aria-label="Task prompt"
            placeholder={followup ? 'Ask a follow-up…' : 'Ask anything…'}
            rows={1}
            wrap={expanded ? 'soft' : 'off'}
            maxLength={100000}
            value={draft.text}
            onChange={(event) => onChange({ ...draft, text: event.target.value })}
          />
          {draft.files.length > 0 && (
            <ul className="attachment-list" aria-label="Attached context">
              {draft.files.map((file) => (
                <li className="attachment-chip" key={file.id}>
                  <span title={file.name}>{file.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      onChange({
                        ...draft,
                        files: draft.files.filter((item) => item.id !== file.id),
                      })
                    }
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <IconButton
            label="Attach context"
            className="composer-attach"
            tooltipSide="top"
            variant="secondary"
            disabled={choosing}
            onClick={() => void choose()}
          >
            <Plus />
          </IconButton>
          <div className="composer-actions">
            <IconButton
              label={label}
              variant="default"
              tooltipSide="top"
              disabled={disabled}
              onClick={() => void act()}
            >
              {active ? (
                <Square className="fill-current size-3" />
              ) : continuing ? (
                <Play />
              ) : (
                <ArrowUp />
              )}
            </IconButton>
          </div>
        </div>
        <ComposerConfiguration
          provider={provider}
          onOpenSettings={onOpenSettings}
          policy={policy}
          onPolicyChange={onPolicyChange}
        />
        {error && (
          <output className="composer-notice" role="alert">
            {error}
          </output>
        )}
      </form>
    </footer>
  );
}
