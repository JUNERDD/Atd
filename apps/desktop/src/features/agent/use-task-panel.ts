import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RunPolicy } from '../../client/agent/run-policy';
import type { PreparedCommand, TaskDetail } from '../../client/agent/bridge';
import type { PermissionRequest } from '../../client/agent/permission-schema';
import { emptyInput, isActive } from '../../client/agent/task-schema';
import { EMPTY_QUEUE } from '../../client/agent/transcript-schema';
import { DEFAULT_SHORTCUTS } from '@atd/agent-contracts';
import {
  draftChips,
  draftReferences,
  draftSkills,
  type ComposerDraft,
} from '../composer-editor/draft';
import { draftFiles, draftFolders } from '../composer-editor/draft-attachments';
import { useSeededSessions } from './use-seeded-sessions';
import { useSettingsSnapshot } from '../settings/use-settings';
import { readDrafts, useRememberComposers } from './use-composer-memory';
import { agentApi, useAgent } from './use-agent';
import { usePageDetail } from './use-page-detail';
import { useChildView } from './use-child-view';
import { useCommandLaunch } from './use-command-launch';
import { trackCommandRun } from './command-results';
import { useRunChoices } from './use-run-choices';
import { useOutgoingMessage } from './outgoing-messages';
import { sendOptimistic, sendSettling, withChips, type PanelSubmit } from './panel-submit';
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
  const [drafts, setDrafts] = useState(readDrafts);
  useWithdrawnQueue(setDrafts);
  const [pending, setPending] = useState(false);
  /** The latest send's invocation, and the conversation it opens if it starts one. */
  const submission = useRef<{ key: string; id: string; taskId: string } | null>(null);
  /**
   * Shows the new conversation as it was left: its draft and model are remembered, not reset. The
   * composer takes focus once the new view is drawn, so starting a chat from the header, a shortcut
   * or `/new` leaves the caret in the prompt rather than on the control that started it.
   */
  const newTask = () => {
    setView('new');
    setTaskId(null);
    setPrepared(null);
    requestAnimationFrame(focusPanelInput);
  };
  // The page holds one task's transcript at a time. A side chat moves the hold to its own task,
  // and every close takes it back for the conversation by reloading it (`useTaskDetail`'s epoch).
  const [holdEpoch, setHoldEpoch] = useState(0);
  const current = usePageDetail(taskId, holdEpoch);
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
  // A message on its way has no run yet: the composer shows one starting, with nothing to stop.
  const sending = useOutgoingMessage(boundTaskId, bound?.task.runs ?? [])?.error === null;
  const servedRun = sending ? undefined : boundRun;
  // A new chat the service has not created has no task for the composer's controls to change.
  const unsaved = !side.taskId && current.unsaved;
  // The command input step on screen: the side chat's, else the page's input view.
  const sideStep = side.view && side.view.phase !== 'task' ? side.view.prepared : null;
  const inputStep = sideStep ?? (view === 'input' ? prepared : null);
  const draftKey = boundTaskId ?? 'new';
  const draft = drafts[draftKey] ?? EMPTY_DRAFT;
  const policyKey = inputStep ? `command-${inputStep.command.id}` : draftKey;
  const shortcuts = snapshot?.shortcuts ?? DEFAULT_SHORTCUTS;
  const nextRun = useRunChoices(snapshot, policyKey, inputStep, boundRun);
  const { policy, model } = nextRun;
  useRememberComposers(drafts, nextRun.choices);
  const seeded = useSeededSessions((seed) => {
    newTask();
    setDraftRevision((value) => value + 1);
    setDrafts((previous) => ({ ...previous, new: seed.draft }));
    nextRun.stage('new', seed.policy);
    focusPanelInput();
  });
  /**
   * Sends the bound conversation's draft, or a command: the one a launch carried (`launched`), whose
   * run uses the command's own policy and leaves drafts, staged policies and remembered model and
   * effort choices untouched, else the input step's. A new task becomes the page's, except one
   * started as conversation `sideChatOf`'s side chat, which the side chat shows; a side chat's
   * follow-up leaves the page as it is too. A message is optimistic (`sendOptimistic`), a new
   * chat's opening its conversation at once (`usePageDetail`): it resolves null, not throwing, when
   * the service does not take it.
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
    const saved = launched || !nextRun.chosen ? null : policy;
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
    if (submission.current?.key !== key)
      submission.current = { key, id: crypto.randomUUID(), taskId: crypto.randomUUID() };
    const { id: invocationId, taskId: newTaskId } = submission.current;
    const send = (runTaskId: string | null) =>
      agentApi().submit({
        invocationId,
        policy: runPolicy,
        taskId: runTaskId,
        commandId: commandInput?.command.id ?? null,
        commandRevision: commandInput?.command.revision ?? null,
        savedRun: null,
        input,
        ...(commandInput ? { output: commandInput.output } : {}),
        ...(commandInput?.shortcutId === undefined ? {} : { shortcutId: commandInput.shortcutId }),
        ...(sideChatOf ? { sideChatOf } : {}),
      });
    // A message shows as sent at once, a new chat's in the conversation it opens before the
    // service creates it; a failure shows on the message rather than refilling the draft.
    if (!commandInput) {
      const runTaskId = targetTaskId ?? newTaskId;
      // A message into the page's unsaved chat would be its task's first, so it opens it anew.
      const opens = !targetTaskId || (current.unsaved && targetTaskId === taskId);
      nextRun.drop();
      setDrafts((previous) =>
        previous[draftKey] === draft ? { ...previous, [draftKey]: EMPTY_DRAFT } : previous,
      );
      if (opens) {
        nextRun.remember(runTaskId);
        current.open(runTaskId, input);
        setTaskId(runTaskId);
        setView('task');
      }
      const message = { id: invocationId, taskId: runTaskId, input, model, sentAt: Date.now() };
      return sendOptimistic(message, () => send(runTaskId), {
        sent: (detail) => {
          if (submission.current?.id === invocationId) submission.current = null;
          if (!sideFollowUp) current.accept(detail);
        },
        // Discarding a new chat's unsent first message leaves no conversation to show.
        discarded: opens ? newTask : undefined,
        begin: () => setPending(true),
        settle: () => setPending(false),
      });
    }
    return sendSettling(
      () => send(null),
      (detail) => {
        submission.current = null;
        trackCommandRun(commandInput, detail);
        // A launched command's run takes none of the panel's staged policy or picked model.
        if (!launched) {
          nextRun.drop();
          nextRun.remember(detail.task.id);
        }
        if (!sideChatOf) {
          current.accept(detail);
          setTaskId(detail.task.id);
          setView('task');
          setPrepared(null);
        }
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
    changePolicy: nextRun.change,
    model,
    /** The composer's task-bound props, from the conversation it serves. */
    bound: {
      taskId: boundTaskId,
      status: sending ? 'queued' : boundRun?.status,
      unsaved,
      task: unsaved ? null : (bound?.task ?? null),
      blocks: bound?.blocks,
      context: bound?.context ?? null,
      requests: bound?.requests ?? NO_REQUESTS,
      queue: bound?.queue ?? EMPTY_QUEUE,
      onStop:
        boundTaskId && servedRun ? () => agentApi().stop(boundTaskId, servedRun.id) : undefined,
      // Under a subagent's view, and while a side chat's command has not started, nothing to serve.
      hidden: child.childKey !== null || sideStep !== null || side.child.childKey !== null,
    },
    /** The conversation's pending requests, for its subagent views. */
    requests: current.detail?.requests ?? NO_REQUESTS,
  };
}
