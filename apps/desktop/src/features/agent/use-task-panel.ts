import { useEffect, useRef, useState } from 'react';
import { useHotkeys, type Options } from 'react-hotkeys-hook';
import { DEFAULT_SHORTCUTS } from '../../../electron/settings-contract';
import type { RunPolicy } from '../../../electron/agent/run-policy';
import type { PreparedCommand } from '../../../electron/agent/bridge';
import { emptyInput, type TaskRun } from '../../../electron/agent/task-schema';
import type { ComposerDraft } from '../../components/composer';
import { useSettingsSnapshot } from '../settings/use-settings';
import { acceleratorToHotkey } from '../../lib/shortcuts';
import { STORAGE_KEY } from '../../lib/task-store';
import { agentApi, messageOf, useAgent, useTaskDetail } from './use-agent';

type View = 'new' | 'history' | 'task' | 'commands' | 'input';
const EMPTY_DRAFT: ComposerDraft = { text: '', files: [] };

export function useTaskPanel() {
  const agent = useAgent();
  const { snapshot } = useSettingsSnapshot();
  const [draftRevision, setDraftRevision] = useState(0);
  const [view, setView] = useState<View>('new');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedCommand | null>(null);
  const [savedRun, setSavedRun] = useState<{ taskId: string; runId: string } | null>(null);
  const [policies, setPolicies] = useState<Record<string, RunPolicy>>({});
  const [drafts, setDrafts] = useState<Record<string, ComposerDraft>>({});
  const [hidden, setHidden] = useState(false);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const submission = useRef<{ key: string; id: string } | null>(null);
  const current = useTaskDetail(taskId);
  const draftKey = view === 'task' && taskId ? taskId : 'new';
  const draft = drafts[draftKey] ?? EMPTY_DRAFT;
  const policyKey = view === 'input' && prepared ? `command-${prepared.command.id}` : draftKey;
  const shortcuts = snapshot?.shortcuts ?? DEFAULT_SHORTCUTS;
  const platform = window.desktop?.platform ?? 'web';
  const options: Options = {
    delimiter: '|',
    useKey: false,
    enableOnFormTags: true,
    enableOnContentEditable: true,
    preventDefault: true,
    enabled: (event) => !event.repeat,
    ignoreEventWhen: (event) =>
      event.defaultPrevented || event.isComposing || event.keyCode === 229,
  };
  useHotkeys(
    acceleratorToHotkey(shortcuts.openSettings, platform),
    () => void openSettings(),
    options,
    [],
  );
  useHotkeys(acceleratorToHotkey(shortcuts.newConversation, platform), newTask, options, []);
  useHotkeys(
    'escape',
    () => {
      if (view !== 'new') setView('new');
      else void hide();
    },
    { ...options, ignoreModifiers: true, preventDefault: false },
    [view],
  );
  useEffect(() => {
    const bridge = window.desktop?.agent;
    if (!bridge) return;
    const unsubscribe = bridge.onLaunch((value) => {
      setPrepared(value);
      setSavedRun(null);
      setView('input');
    });
    void Promise.resolve()
      .then(() =>
        bridge.importLegacy(localStorage.getItem(STORAGE_KEY) ?? '{"version":1,"tasks":[]}'),
      )
      .catch((error) => setNotice(messageOf(error)));
    return unsubscribe;
  }, []);

  function newTask() {
    setDraftRevision((value) => value + 1);
    setDrafts((previous) => ({ ...previous, new: EMPTY_DRAFT }));
    setPolicies((previous) => {
      const next = { ...previous };
      delete next.new;
      return next;
    });
    setView('new');
    setTaskId(null);
    setPrepared(null);
    setSavedRun(null);
    setNotice('');
  }
  async function openSettings() {
    try {
      if (window.desktop) await window.desktop.settings.open();
      else {
        const url = new URL(location.href);
        url.hash = 'settings';
        const opened = window.open(url, 'ai-settings', 'width=1000,height=720');
        opened?.focus();
      }
    } catch (error) {
      setNotice(messageOf(error));
    }
  }
  async function hide() {
    try {
      if (window.desktop) await window.desktop.hide();
      else setHidden(true);
    } catch (error) {
      setNotice(messageOf(error));
    }
  }
  function changeDraft(value: ComposerDraft) {
    setDrafts((previous) => ({ ...previous, [draftKey]: value }));
  }
  async function chooseCommand(id: string) {
    try {
      setPrepared(await agentApi().prepare(id));
      setSavedRun(null);
      setView('input');
      setNotice('');
    } catch (error) {
      setNotice(messageOf(error));
    }
  }
  async function submit(continueTask = false) {
    if (pending) return;
    setPending(true);
    setNotice('');
    const commandInput = view === 'input' ? prepared : null;
    const input = commandInput?.input ?? {
      ...emptyInput(),
      text: continueTask ? 'continue task' : draft.text,
      files: continueTask ? [] : draft.files,
    };
    const key = JSON.stringify({
      policy: policies[policyKey],
      input: { ...input, capturedAt: commandInput ? input.capturedAt : '' },
      taskId: view === 'task' ? taskId : null,
      commandId: commandInput?.command.id,
      revision: commandInput?.command.revision,
      savedRun,
    });
    if (submission.current?.key !== key) submission.current = { key, id: crypto.randomUUID() };
    try {
      const detail = await agentApi().submit({
        invocationId: submission.current.id,
        policy: policies[policyKey] ?? null,
        taskId: view === 'task' ? taskId : null,
        commandId: commandInput?.command.id ?? null,
        commandRevision: commandInput?.command.revision ?? null,
        savedRun,
        input,
      });
      submission.current = null;
      setPolicies((previous) => {
        const next = { ...previous };
        delete next[policyKey];
        return next;
      });
      setTaskId(detail.task.id);
      setView('task');
      setSavedRun(null);
      setPrepared(null);
      if (!continueTask)
        setDrafts((previous) =>
          previous[draftKey] === draft ? { ...previous, [draftKey]: EMPTY_DRAFT } : previous,
        );
    } finally {
      setPending(false);
    }
  }
  function rerun(run: TaskRun) {
    if (!taskId) return;
    setSavedRun({ taskId, runId: run.id });
    if (run.snapshot.command) {
      setPrepared({
        command: run.snapshot.command,
        input: structuredClone(run.snapshot.input),
        notice: 'Using the saved command version. Review before running.',
      });
      setView('input');
    } else {
      setDrafts((previous) => ({
        ...previous,
        new: { text: run.snapshot.input.text, files: run.snapshot.input.files },
      }));
      setView('new');
    }
  }
  const title =
    view === 'history'
      ? 'Tasks'
      : view === 'commands'
        ? 'Commands'
        : view === 'input'
          ? (prepared?.command.name ?? 'Command input')
          : view === 'task'
            ? (current.detail?.task.title ?? 'Task')
            : 'New task';
  const run = current.detail?.task.runs.at(-1);
  const policy: RunPolicy = policies[policyKey] ?? {
    tools:
      view === 'input' && prepared
        ? prepared.command.tools
        : view === 'task' && run
          ? run.snapshot.tools
          : ['read', 'write', 'edit', 'bash'],
    memory:
      view === 'input' && prepared
        ? prepared.command.memory !== 'off'
        : view === 'task' && run
          ? run.snapshot.memory
          : true,
    useDefaultModel: false,
    confirmExpansion: false,
  };
  const changePolicy = (value: RunPolicy) =>
    setPolicies((previous) => ({ ...previous, [policyKey]: value }));
  return {
    agent,
    snapshot,
    view,
    setView,
    taskId,
    setTaskId,
    prepared,
    setPrepared,
    savedRun,
    setSavedRun,
    hidden,
    setHidden,
    notice,
    pending,
    current,
    draftKey,
    draftRevision,
    draft,
    shortcuts,
    newTask,
    openSettings,
    hide,
    changeDraft,
    chooseCommand,
    submit,
    rerun,
    title,
    run,
    policy,
    changePolicy,
  };
}
