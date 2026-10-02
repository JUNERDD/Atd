import { useEffect, useRef, useState } from 'react';
import { useHotkeys, type Options } from 'react-hotkeys-hook';
import { useTranslation } from 'react-i18next';
import type { RunPolicy } from '../../client/agent/run-policy';
import type { PreparedCommand, TaskDetail } from '../../client/agent/bridge';
import { emptyInput, isActive } from '../../client/agent/task-schema';
import { EMPTY_QUEUE } from '../../client/agent/transcript-schema';
import { DEFAULT_SHORTCUTS, type RunReference } from '@ai/agent-contracts';
import { isComposingKey } from '@ai/ui/lib/ime';
import {
  draftChips,
  draftFiles,
  draftReferences,
  draftSkills,
  type ComposerDraft,
} from '../composer-editor/draft';
import { useMemoryCreate } from '../memory/use-memory-create';
import { extensionSeed, type SeedKind } from './extension-seed';
import { useSettingsSnapshot } from '../settings/use-settings';
import { acceleratorToHotkey } from '../../lib/shortcuts';
import { agentApi, useAgent, useTaskDetail } from './use-agent';
import { useChildView } from './use-child-view';
import { showErrorToast } from '../../components/toast-store';
import { useAgentNotices } from './use-notices';
import { focusPanelInput, showPanel, usePanelWindow } from './use-panel-window';

/** Longest answer a Remember seed quotes in full. */
const REMEMBER_LIMIT = 90_000;

type View = 'new' | 'history' | 'task' | 'input';
/** The edit-with-AI sentence per extension kind; memory sessions never carry a target. */
const EDIT_SEEDS = {
  skill: 'session.editSkillSeed',
  subagent: 'session.editSubagentSeed',
  mcp: 'session.editMcpSeed',
} as const;
const EMPTY_DRAFT: ComposerDraft = { text: '', chips: [] };

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
  const memoryCreate = useMemoryCreate();
  const current = useTaskDetail(taskId);
  const child = useChildView(view === 'task' ? taskId : null, current.detail?.requests ?? []);
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
    ignoreEventWhen: (event) => event.defaultPrevented || isComposingKey(event),
  };
  useHotkeys(
    acceleratorToHotkey(shortcuts.openSettings, platform),
    () => void openSettings(),
    options,
    [],
  );
  useHotkeys(acceleratorToHotkey(shortcuts.newConversation, platform), newTask, options, []);
  // Escape steps back one level: out of a subagent's conversation, then to a new chat, then hide.
  useHotkeys(
    'escape',
    () => {
      if (child.childKey) child.close();
      else if (view !== 'new') setView('new');
      else void hide();
    },
    { ...options, ignoreModifiers: true, preventDefault: false },
    [view, child.childKey],
  );
  useEffect(() => {
    const bridge = window.desktop?.agent;
    if (!bridge) return;
    return bridge.onLaunch(({ prepared: value, autoRun: run }) => {
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
  }, []);
  // Create-with-AI (Extensions, Memory, the command editor) seeds a `create-*` skill chip on the
  // new draft; edit-with-AI adds a sentence naming the existing item.
  useEffect(() => {
    const bridge = window.desktop?.agent;
    if (!bridge) return;
    return bridge.onCommandSession(({ commandId, name }) =>
      startSeeded('command', commandId ? t('session.editSeed', { name, id: commandId }) : ''),
    );
  }, [t]);
  useEffect(() => {
    const bridge = window.desktop?.agent;
    if (!bridge) return;
    return bridge.onExtensionSession(({ kind, target }) =>
      startSeeded(
        kind,
        target === null || kind === 'memory' ? '' : t(EDIT_SEEDS[kind], { name: target }),
      ),
    );
  }, [t]);
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
  /** A create-with-AI session on the new draft (`extensionSeed`). */
  function startSeeded(kind: SeedKind, sentence: string) {
    newTask();
    const seed = extensionSeed(kind, sentence);
    setDrafts((previous) => ({ ...previous, new: seed.draft }));
    setPolicies((previous) => ({ ...previous, new: seed.policy }));
    focusPanelInput();
  }
  /** Shows a task, as choosing it from the history does. */
  function openTask(id: string) {
    setTaskId(id);
    setView('task');
  }
  /** A memory session seeded with `text` (a turn's answer), once memory can save it. */
  function remember(text: string) {
    // The seed becomes the draft, whose text the service caps at 100,000 characters; a longer
    // answer is cut with an ellipsis, leaving room for the chip and the sentence around it.
    const quoted = text.length > REMEMBER_LIMIT ? `${text.slice(0, REMEMBER_LIMIT)}…` : text;
    memoryCreate.start(null, () =>
      startSeeded('memory', t('session.rememberSeed', { text: quoted })),
    );
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
   * leaves drafts, view state and remembered model and effort choices untouched.
   */
  async function submit(launched?: PreparedCommand): Promise<TaskDetail | null> {
    if (pending) return null;
    const run = current.detail?.task.runs.at(-1);
    if (!launched && view === 'task' && isActive(run?.status)) return null;
    const commandInput = launched ?? (view === 'input' ? prepared : null);
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
    };
    const skills = commandInput ? [] : draftSkills(draft);
    const references = commandInput ? [] : draftReferences(draft);
    const saved = launched ? null : (policies[policyKey] ?? null);
    const policy: RunPolicy | null =
      skills.length || references.length
        ? withChips(saved ?? defaultPolicy, skills, references)
        : saved;
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
  const defaultPolicy: RunPolicy = {
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
    confirmExpansion: false,
  };
  const policy = policies[policyKey] ?? defaultPolicy;
  const changePolicy = (value: RunPolicy) =>
    setPolicies((previous) => ({ ...previous, [policyKey]: value }));
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
    draftKey,
    draftRevision,
    draft,
    shortcuts,
    newTask,
    openTask,
    remember,
    openSettings,
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
