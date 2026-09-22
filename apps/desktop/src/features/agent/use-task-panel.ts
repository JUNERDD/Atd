import { useEffect, useRef, useState } from 'react';
import { useHotkeys, type Options } from 'react-hotkeys-hook';
import { useTranslation } from 'react-i18next';
import { DEFAULT_SHORTCUTS } from '../../../electron/settings-contract';
import type { RunPolicy } from '../../../electron/agent/run-policy';
import type { PreparedCommand, TaskDetail } from '../../../electron/agent/bridge';
import { emptyInput, isActive } from '../../../electron/agent/task-schema';
import { EMPTY_QUEUE } from '../../../electron/agent/transcript-schema';
import type { ComposerDraft } from '../../components/composer';
import { useSettingsSnapshot } from '../settings/use-settings';
import { acceleratorToHotkey } from '../../lib/shortcuts';
import { STORAGE_KEY } from '../../lib/task-store';
import { agentApi, useAgent, useTaskDetail } from './use-agent';
import { showErrorToast } from '../../components/toast-store';
import { useAgentNotices } from './use-notices';
import { focusPanelInput, showPanel, usePanelWindow } from './use-panel-window';

type View = 'new' | 'history' | 'task' | 'input';
const EMPTY_DRAFT: ComposerDraft = { text: '', files: [] };

export function useTaskPanel() {
  const { t } = useTranslation('panel');
  const agent = useAgent();
  useAgentNotices();
  const { snapshot } = useSettingsSnapshot();
  const { hidden, setHidden, openSettings, hide } = usePanelWindow();
  const [draftRevision, setDraftRevision] = useState(0);
  const [view, setView] = useState<View>('new');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedCommand | null>(null);
  const [autoRun, setAutoRun] = useState<PreparedCommand | null>(null);
  const runAuto = useRef<(command: PreparedCommand) => void>(() => {});
  const [revealCount, setRevealCount] = useState(0);
  const [policies, setPolicies] = useState<Record<string, RunPolicy>>({});
  const [drafts, setDrafts] = useState<Record<string, ComposerDraft>>({});
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
    const unsubscribe = bridge.onLaunch(({ prepared: value, autoRun: run }) => {
      if (run) {
        // A shortcut run never shows the command input: the panel is revealed when its task is on
        // screen, or on the input page with the failure when the run cannot start.
        setAutoRun(value);
        return;
      }
      setPrepared(value);
      setView('input');
      setRevealCount((count) => count + 1);
    });
    void Promise.resolve()
      .then(() =>
        bridge.importLegacy(localStorage.getItem(STORAGE_KEY) ?? '{"version":1,"tasks":[]}'),
      )
      .catch((error) => showErrorToast(error));
    return unsubscribe;
  }, []);
  // The command editor hands its work to the panel: a fresh session gets the seed text in the `new`
  // draft, so the user completes the intent and sends it with the agent's tools.
  useEffect(() => {
    const bridge = window.desktop?.agent;
    if (!bridge) return;
    return bridge.onCommandSession(({ commandId, name }) => {
      newTask();
      setDrafts((previous) => ({
        ...previous,
        new: {
          text: commandId
            ? t('session.editSeed', { name, id: commandId })
            : t('session.createSeed'),
          files: [],
        },
      }));
      focusPanelInput();
    });
  }, [t]);
  // Extensions create-with-AI seeds `/skill:create-*` and stages that app skill on the new draft.
  useEffect(() => {
    const bridge = window.desktop?.agent;
    if (!bridge) return;
    return bridge.onExtensionSession(({ kind }) => {
      const skillName =
        kind === 'skill' ? 'create-skill' : kind === 'subagent' ? 'create-subagent' : 'create-mcp';
      newTask();
      setDrafts((previous) => ({
        ...previous,
        new: { text: `/skill:${skillName} `, files: [] },
      }));
      setPolicies((previous) => ({
        ...previous,
        new: {
          tools: ['read', 'write', 'edit', 'bash', 'command'],
          memory: true,
          useDefaultModel: false,
          confirmExpansion: false,
          skills: [{ name: skillName }],
        },
      }));
      focusPanelInput();
    });
  }, []);
  // A failed start restores the command input for repair. The reveal counter is raised together
  // with the launched view, so the commit that reveals the panel already renders that view; every
  // launch is a fresh object, so the trigger fires exactly once per shortcut press.
  useEffect(() => {
    runAuto.current = (command) => {
      void submit(command)
        .then((detail) => {
          if (detail) setRevealCount((count) => count + 1);
        })
        .catch((error) => {
          setPrepared(command);
          setView('input');
          showErrorToast(error);
          setRevealCount((count) => count + 1);
        });
    };
  });
  useEffect(() => {
    if (autoRun) runAuto.current(autoRun);
  }, [autoRun]);
  useEffect(() => {
    if (revealCount) void showPanel();
  }, [revealCount]);

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
  }
  function changeDraft(value: ComposerDraft) {
    setDrafts((previous) => ({ ...previous, [draftKey]: value }));
  }
  async function chooseCommand(id: string) {
    try {
      setPrepared(await agentApi().prepare(id));
      setView('input');
    } catch (error) {
      showErrorToast(error);
    }
  }
  /**
   * Shortcut launches submit the command they carried: the run uses the command's own policy and
   * leaves drafts, view state and remembered capability adjustments untouched.
   */
  async function submit(launched?: PreparedCommand): Promise<TaskDetail | null> {
    if (pending) return null;
    const run = current.detail?.task.runs.at(-1);
    if (!launched && view === 'task' && isActive(run?.status)) return null;
    setPending(true);
    const commandInput = launched ?? (view === 'input' ? prepared : null);
    const input = commandInput?.input ?? {
      ...emptyInput(),
      text: draft.text,
      files: draft.files,
    };
    const policy = launched ? null : (policies[policyKey] ?? null);
    const targetTaskId = launched ? null : view === 'task' ? taskId : null;
    const key = JSON.stringify({
      policy,
      input: { ...input, capturedAt: commandInput ? input.capturedAt : '' },
      taskId: targetTaskId,
      commandId: commandInput?.command.id,
      revision: commandInput?.command.revision,
    });
    if (submission.current?.key !== key) submission.current = { key, id: crypto.randomUUID() };
    try {
      const detail = await agentApi().submit({
        invocationId: submission.current.id,
        policy,
        taskId: targetTaskId,
        commandId: commandInput?.command.id ?? null,
        commandRevision: commandInput?.command.revision ?? null,
        savedRun: null,
        input,
      });
      submission.current = null;
      if (!launched)
        setPolicies((previous) => {
          const next = { ...previous };
          delete next[policyKey];
          return next;
        });
      setTaskId(detail.task.id);
      setView('task');
      setPrepared(null);
      if (!launched)
        setDrafts((previous) =>
          previous[draftKey] === draft ? { ...previous, [draftKey]: EMPTY_DRAFT } : previous,
        );
      return detail;
    } finally {
      setPending(false);
    }
  }
  const title =
    view === 'history'
      ? t('titles.tasks')
      : view === 'input'
        ? (prepared?.command.name ?? t('titles.commandInput'))
        : view === 'task'
          ? (current.detail?.task.title ?? t('titles.task'))
          : t('titles.newTask');
  const run = current.detail?.task.runs.at(-1);
  const policy: RunPolicy = policies[policyKey] ?? {
    tools:
      view === 'input' && prepared
        ? prepared.command.tools
        : view === 'task' && run
          ? run.snapshot.tools
          : ['read', 'write', 'edit', 'bash', 'command'],
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
    hidden,
    setHidden,
    pending,
    current,
    draftKey,
    draftRevision,
    draft,
    shortcuts,
    platform,
    newTask,
    openSettings,
    hide,
    changeDraft,
    chooseCommand,
    submit,
    title,
    run,
    policy,
    changePolicy,
    requests: current.detail?.requests ?? [],
    queue: current.detail?.queue ?? EMPTY_QUEUE,
  };
}
