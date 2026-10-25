import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RunPolicy } from '../../client/agent/run-policy';
import type { PreparedCommand, TaskDetail } from '../../client/agent/bridge';
import type { PermissionRequest } from '../../client/agent/permission-schema';
import { launchSettings } from '../../client/agent/command-prepare';
import { emptyInput, isActive } from '../../client/agent/task-schema';
import { EMPTY_QUEUE } from '../../client/agent/transcript-schema';
import { DEFAULT_SHORTCUTS, runModelSelection } from '@atd/agent-contracts';
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
import { trackCommandRun } from './command-results';
import { sendSettling, withChips, type PanelSubmit } from './panel-submit';
import { usePanelHotkeys } from './use-panel-hotkeys';
import { useSideChat } from './side-chat/use-side-chat';
import { showErrorToast } from '../../components/toast-store';
import { useAgentNotices } from './use-notices';
import { focusPanelInput, usePanelWindow } from './use-panel-window';
import { useMarkAutomationRunRead, useTaskOpenRequests } from './use-task-open-requests';
import { useTaskShown } from './use-task-shown';
import { useWithdrawnQueue } from './use-withdrawn-queue';

export type PanelView = 'new' | 'history' | 'apps' | 'task' | 'input';
const EMPTY_DRAFT: ComposerDraft = { text: '', chips: [] };
const NO_REQUESTS: PermissionRequest[] = [];

/** What the side chat starts through until the first commit, before which nothing can start. */
const UNMOUNTED: PanelSubmit = () => Promise.reject(new Error('The task panel has not mounted.'));

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
  useWithdrawnQueue(setDrafts);
  const [choices, setChoices] = useState(readChoices);
  useRememberComposers(drafts, choices);
  const [pending, setPending] = useState(false);
  const submission = useRef<{ key: string; id: string } | null>(null);
  /** Shows the new conversation as it was left: its draft and model are remembered, not reset. */
  const newTask = () => {
    setView('new');
    setTaskId(null);
    setPrepared(null);
  };
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
  // What the latest send returned shows its conversation until the detail loads.
  const [sent, setSent] = useState<TaskDetail | null>(null);
  if (sent && sent.task.id !== taskId) setSent(null);
  const current = useTaskDetail(taskId, holdEpoch, sent);
  const scope = view === 'task' ? taskId : null;
  const child = useChildView(scope, current.detail?.requests ?? NO_REQUESTS);
  // `submit` reads the side chat it serves, so the side chat starts its runs through the `submit`
  // of the latest commit; it starts none before one.
  const latestSubmit = useRef<PanelSubmit>(UNMOUNTED);
  const side = useSideChat({
    scope,
    status: agent.snapshot?.tasks.find((task) => task.id === scope)?.runs.at(-1)?.status,
    dismissChild: child.dismiss,
    start: (conversationId, launched) => latestSubmit.current(launched, conversationId),
    rehold: () => setHoldEpoch((epoch) => epoch + 1),
  });
  // The composer serves one conversation: the side chat's task while it shows one, else the page's.
  const boundTaskId = side.taskId ?? scope;
  // The shell notifies about every task but the one the person is looking at.
  useTaskShown(boundTaskId);
  const bound = side.taskId ? side.detail : scope ? current.detail : null;
  const boundRun = bound?.task.runs.at(-1);
  // The command input step on screen: the side chat's, else the page's input view.
  const sideStep = side.view && side.view.phase !== 'task' ? side.view.prepared : null;
  const inputStep = sideStep ?? (view === 'input' ? prepared : null);
  const draftKey = boundTaskId ?? 'new';
  const draft = drafts[draftKey] ?? EMPTY_DRAFT;
  const policyKey = inputStep ? `command-${inputStep.command.id}` : draftKey;
  const shortcuts = snapshot?.shortcuts ?? DEFAULT_SHORTCUTS;
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
      output: commandInput?.output,
      shortcutId: commandInput?.shortcutId,
    });
    if (submission.current?.key !== key) submission.current = { key, id: crypto.randomUUID() };
    const invocationId = submission.current.id;
    return sendSettling(
      () =>
        agentApi().submit({
          invocationId,
          policy: runPolicy,
          taskId: targetTaskId,
          commandId: commandInput?.command.id ?? null,
          commandRevision: commandInput?.command.revision ?? null,
          savedRun: null,
          input,
          ...(commandInput ? { output: commandInput.output } : {}),
          ...(commandInput?.shortcutId === undefined
            ? {}
            : { shortcutId: commandInput.shortcutId }),
          ...(sideChatOf ? { sideChatOf } : {}),
        }),
      (detail) => {
        submission.current = null;
        if (commandInput) trackCommandRun(commandInput, detail);
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
          setSent(detail);
          setTaskId(detail.task.id);
          setView('task');
          setPrepared(null);
        }
        // Only a sent draft clears; a command's run leaves the draft as it was.
        if (!commandInput)
          setDrafts((previous) =>
            previous[draftKey] === draft ? { ...previous, [draftKey]: EMPTY_DRAFT } : previous,
          );
      },
      () => setPending(false),
    );
  }
  useLayoutEffect(() => {
    latestSubmit.current = submit;
  });
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
  const { dismiss: dismissSide } = side;
  /** Shows a task, as choosing it from the history does, with no side chat over it. */
  const openTask = useCallback(
    (id: string) => {
      dismissSide();
      setTaskId(id);
      setView('task');
    },
    [dismissSide],
  );
  useCommandLaunch({
    submit: (launched) => submit(launched),
    showInput: (value) => {
      setPrepared(value);
      setView('input');
    },
    openTask,
  });
  // Settings and an automation's notification show a task the same way, and an automation's
  // result counts as read once its task shows.
  useTaskOpenRequests(openTask);
  useMarkAutomationRunRead(
    view === 'task' ? agent.snapshot?.tasks.find((task) => task.id === taskId) : undefined,
  );

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
  // before images are sent. A command run starts from its launching shortcut's model, if any.
  const model =
    runModelSelection({
      requested: policy.model ?? null,
      command: inputStep ? launchSettings(inputStep).model : null,
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
