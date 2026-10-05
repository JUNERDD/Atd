import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RunPolicy } from '../../client/agent/run-policy';
import type { PreparedCommand, TaskDetail } from '../../client/agent/bridge';
import type { PermissionRequest } from '../../client/agent/permission-schema';
import { emptyInput, isActive } from '../../client/agent/task-schema';
import { EMPTY_QUEUE } from '../../client/agent/transcript-schema';
import { DEFAULT_SHORTCUTS, runModelSelection, type RunReference } from '@atd/agent-contracts';
import {
  draftChips,
  draftReferences,
  draftSkills,
  type ComposerDraft,
} from '../composer-editor/draft';
import { draftFiles, draftFolders } from '../composer-editor/draft-attachments';
import { useSeededSessions } from './use-seeded-sessions';
import { useSettingsSnapshot } from '../settings/use-settings';
import { readChoices, readDrafts, useRememberComposers, usableChoice } from './use-composer-memory';
import { agentApi, useAgent, useTaskDetail } from './use-agent';
import { useChildView } from './use-child-view';
import { useCommandLaunch } from './use-command-launch';
import { usePanelHotkeys } from './use-panel-hotkeys';
import { useSideChat } from './side-chat/use-side-chat';
import { showErrorToast } from '../../components/toast-store';
import { useAgentNotices } from './use-notices';
import { focusPanelInput, usePanelWindow } from './use-panel-window';

export type PanelView = 'new' | 'history' | 'apps' | 'task' | 'input';
const EMPTY_DRAFT: ComposerDraft = { text: '', chips: [] };
const NO_REQUESTS: PermissionRequest[] = [];

/**
 * Stages what the draft's chips select: the skills are the draft's skill chips, and the references
 * are exactly its conversation, MCP server and subagent chips, each item once.
 */
function withChips(policy: RunPolicy, skills: string[], references: RunReference[]): RunPolicy {
  return {
    ...policy,
    ...(skills.length ? { skills: skills.map((name) => ({ name })) } : {}),
    ...(references.length ? { references } : {}),
  };
}

export function useTaskPanel() {
  const { t } = useTranslation('panel');
  const agent = useAgent();
  useAgentNotices();
  const { snapshot, failed: settingsFailed } = useSettingsSnapshot();
  const { t: tSettings } = useTranslation('settings');
  // The panel has no place for the settings window's inline error; a failed read toasts once.
  useEffect(() => {
    if (settingsFailed) showErrorToast(tSettings('window.loadError'));
  }, [settingsFailed, tSettings]);
  const { openSettings, hide } = usePanelWindow();
  const [draftRevision, setDraftRevision] = useState(0);
  const [view, setView] = useState<PanelView>('new');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedCommand | null>(null);
  const [policies, setPolicies] = useState<Record<string, RunPolicy>>({});
  const [drafts, setDrafts] = useState(readDrafts);
  const [choices, setChoices] = useState(readChoices);
  useRememberComposers(drafts, choices);
  const [pending, setPending] = useState(false);
  const submission = useRef<{ key: string; id: string } | null>(null);
  const seeded = useSeededSessions((seed) => {
    newTask();
    setDraftRevision((value) => value + 1);
    setDrafts((previous) => ({ ...previous, new: seed.draft }));
    setPolicies((previous) => ({ ...previous, new: seed.policy }));
    focusPanelInput();
  });
  // The page holds one task's transcript at a time. A side chat moves the hold to its own task,
  // and every close takes it back for the conversation by reloading it (`useTaskDetail`'s epoch).
  const [holdEpoch, setHoldEpoch] = useState(0);
  const current = useTaskDetail(taskId, holdEpoch);
  const scope = view === 'task' ? taskId : null;
  const child = useChildView(scope, current.detail?.requests ?? NO_REQUESTS);
  const side = useSideChat({
    scope,
    status: agent.snapshot?.tasks.find((task) => task.id === scope)?.runs.at(-1)?.status,
    dismissChild: child.dismiss,
    start: (conversationId, launched) => submit(launched, conversationId),
    rehold: () => setHoldEpoch((epoch) => epoch + 1),
  });
  // The composer serves one conversation: the side chat's task while it shows one, else the page's.
  const boundTaskId = side.taskId ?? scope;
  const bound = side.taskId ? side.detail : scope ? current.detail : null;
  const boundRun = bound?.task.runs.at(-1);
  // The command input step on screen: the side chat's, else the page's input view.
  const sideStep = side.view && side.view.phase !== 'task' ? side.view.prepared : null;
  const inputStep = sideStep ?? (view === 'input' ? prepared : null);
  const draftKey = boundTaskId ?? 'new';
  const draft = drafts[draftKey] ?? EMPTY_DRAFT;
  const policyKey = inputStep ? `command-${inputStep.command.id}` : draftKey;
  const shortcuts = snapshot?.shortcuts ?? DEFAULT_SHORTCUTS;
  usePanelHotkeys(shortcuts, {
    openSettings: () => void openSettings(),
    newConversation: newTask,
    // One level per press: the side chat's subagent view, the side chat, the conversation's
    // subagent view, a new chat, then the panel hides.
    escape: () => {
      if (side.child.childKey) side.child.close();
      else if (side.view) side.close();
      else if (child.childKey) child.close();
      else if (view !== 'new') setView('new');
      else void hide();
    },
  });
  useCommandLaunch({
    submit: (launched) => submit(launched),
    showInput: (value) => {
      setPrepared(value);
      setView('input');
    },
  });
  // Continue editing an app from Settings shows the task that builds it, uncovered.
  const { dismiss: dismissSide } = side;
  useEffect(
    () =>
      window.desktop?.apps?.onShowTask((id) => {
        dismissSide();
        setTaskId(id);
        setView('task');
      }),
    [dismissSide],
  );

  /** Shows the new conversation as it was left: its draft and model are remembered, not reset. */
  function newTask() {
    setView('new');
    setTaskId(null);
    setPrepared(null);
  }
  /** Shows a task, as choosing it from the history does, with no side chat over it. */
  function openTask(id: string) {
    side.dismiss();
    setTaskId(id);
    setView('task');
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
   * Sends the bound conversation's draft, or a command: the one a launch carried (`launched`), whose
   * run uses the command's own policy and leaves drafts, staged policies and remembered model and
   * effort choices untouched, else the input step's. A new task becomes the page's, except one
   * started as conversation `sideChatOf`'s side chat, which the side chat shows; a side chat's
   * follow-up leaves the page as it is too.
   */
  async function submit(
    launched?: PreparedCommand,
    sideChatOf: string | null = null,
  ): Promise<TaskDetail | null> {
    if (pending) return null;
    const commandInput = launched ?? inputStep;
    if (!commandInput && isActive(boundRun?.status)) return null;
    // Chips are the draft's only record of its references: files, skills and references derive
    // from them, and `input.chips` keeps where each chip sits so the transcript can show it again.
    const files = draftFiles(draft);
    if (!commandInput && files.length > 10) throw new Error(t('composer.attachLimit'));
    setPending(true);
    // Always recorded, even empty: a run without `input.chips` reads as sent before chips were.
    const input = commandInput?.input ?? {
      ...emptyInput(),
      text: draft.text,
      files,
      chips: draftChips(draft),
      folders: draftFolders(draft),
    };
    const skills = commandInput ? [] : draftSkills(draft);
    const references = commandInput ? [] : draftReferences(draft);
    // Without a staged policy or a remembered model the service applies its own defaults.
    const saved = launched || !(policies[policyKey] || choice) ? null : policy;
    const runPolicy: RunPolicy | null =
      skills.length || references.length ? withChips(saved ?? policy, skills, references) : saved;
    const targetTaskId = commandInput ? null : boundTaskId;
    const sideFollowUp = targetTaskId !== null && targetTaskId === side.taskId;
    const key = JSON.stringify({
      policy: runPolicy,
      input: { ...input, capturedAt: commandInput ? input.capturedAt : '' },
      taskId: targetTaskId,
      sideChatOf,
      commandId: commandInput?.command.id,
      revision: commandInput?.command.revision,
    });
    if (submission.current?.key !== key) submission.current = { key, id: crypto.randomUUID() };
    try {
      const detail = await agentApi().submit({
        invocationId: submission.current.id,
        policy: runPolicy,
        taskId: targetTaskId,
        commandId: commandInput?.command.id ?? null,
        commandRevision: commandInput?.command.revision ?? null,
        savedRun: null,
        input,
        ...(sideChatOf ? { sideChatOf } : {}),
      });
      submission.current = null;
      if (!launched)
        setPolicies((previous) => {
          const next = { ...previous };
          delete next[policyKey];
          return next;
        });
      // The conversation this message started keeps the model it was sent with.
      if (choice && !launched && !targetTaskId)
        setChoices((previous) => ({ ...previous, [detail.task.id]: choice }));
      if (!sideChatOf && !sideFollowUp) {
        setTaskId(detail.task.id);
        setView('task');
        setPrepared(null);
      }
      // Only a sent draft clears; a command's run leaves the draft as it was.
      if (!commandInput)
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
      : view === 'apps'
        ? t('titles.apps')
        : view === 'input'
          ? (prepared?.command.name ?? t('titles.commandInput'))
          : view === 'task'
            ? (current.detail?.task.title ?? t('titles.task'))
            : t('titles.newTask');
  const defaultPolicy: RunPolicy = {
    tools: inputStep
      ? inputStep.command.tools
      : boundRun
        ? boundRun.snapshot.tools
        : ['read', 'write', 'edit', 'bash', 'command'],
    memory: inputStep
      ? inputStep.command.memory !== 'off'
      : boundRun
        ? boundRun.snapshot.memory
        : true,
    confirmExpansion: false,
  };
  // The model and effort belong to the conversation's memory; the policy only stages the rest.
  const choice = usableChoice(choices[policyKey], snapshot?.connections);
  const policy: RunPolicy = { ...(policies[policyKey] ?? defaultPolicy), ...choice };
  function changePolicy({ model, thinkingLevel, ...staged }: RunPolicy) {
    setPolicies((previous) => ({ ...previous, [policyKey]: staged }));
    setChoices((previous) => ({
      ...previous,
      [policyKey]: { ...(model ? { model } : {}), ...(thinkingLevel ? { thinkingLevel } : {}) },
    }));
  }
  const defaultConnection = snapshot?.connections.find(
    (connection) => connection.connectionId === snapshot.defaultConnectionId,
  );
  // The run's model as the service selects it (`runModelSelection`), else the default: the
  // composer's picker shows it, and the composer and the command input check it for image input
  // before images are sent.
  const model =
    runModelSelection({
      requested: policy.model ?? null,
      command: inputStep?.command.model ?? null,
      last: inputStep ? null : (boundRun?.snapshot.model ?? null),
      hasConnection: (connectionId) =>
        snapshot?.connections.some((item) => item.connectionId === connectionId) ?? false,
    }) ??
    (defaultConnection?.defaultModel
      ? { connectionId: defaultConnection.connectionId, modelId: defaultConnection.defaultModel }
      : null);
  return {
    agent,
    snapshot,
    view,
    setView,
    taskId,
    prepared,
    setPrepared,
    pending,
    current,
    child,
    side,
    draftKey,
    draftRevision,
    draft,
    shortcuts,
    newTask,
    openTask,
    remember: seeded.remember,
    createApp: seeded.createApp,
    openSettings,
    changeDraft,
    chooseCommand,
    submit,
    title,
    policy,
    changePolicy,
    model,
    /** The composer's task-bound props, from the conversation it serves. */
    bound: {
      taskId: boundTaskId,
      runId: boundRun?.id,
      status: boundRun?.status,
      task: bound?.task ?? null,
      blocks: bound?.blocks,
      context: bound?.context ?? null,
      requests: bound?.requests ?? NO_REQUESTS,
      queue: bound?.queue ?? EMPTY_QUEUE,
      onStop: boundTaskId && boundRun ? () => agentApi().stop(boundTaskId, boundRun.id) : undefined,
      // Under a subagent's view, and while a side chat's command has not started, nothing to serve.
      hidden: child.childKey !== null || sideStep !== null || side.child.childKey !== null,
    },
    /** The conversation's pending requests, for its subagent views. */
    requests: current.detail?.requests ?? NO_REQUESTS,
  };
}
