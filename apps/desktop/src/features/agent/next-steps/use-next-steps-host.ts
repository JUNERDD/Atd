import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_NEXT_STEP_CLICK,
  DEFAULT_NEXT_STEPS,
  type NextStepClick,
} from '@atd/agent-contracts';
import { showErrorToast } from '../../../components/toast-store';
import {
  isEmptyDraft,
  sameContent,
  seedFromText,
  type ComposerDraft,
} from '../../composer-editor/draft';
import { focusPanelInput } from '../use-panel-window';
import type { NextStepActions, NextStepsHost } from './use-next-steps-offer';

/** The draft key of the new conversation (`useTaskPanel`), where a suggested new task opens. */
const NEW_CONVERSATION = 'new';

/** The panel state and operations the suggestions act through, as of the latest commit. */
interface PanelDrafts {
  /** The settings snapshot's switches; null until it first loads, when the defaults apply. */
  settings: { nextSteps: boolean; nextStepClick: NextStepClick } | null;
  /** The conversation the composer serves (its task id, or the new conversation's key). */
  draftKey: string;
  draft: ComposerDraft;
  changeDraft: (draft: ComposerDraft) => void;
  /** Shows the new conversation. */
  newTask: () => void;
  /** Sends the served conversation's draft the way the composer's Send does. */
  submit: () => Promise<unknown>;
}

/**
 * A prompt waiting for conversation `key` to be the one the composer serves: it becomes that
 * draft, then is focused or sent. A send in the current conversation puts back the draft it
 * replaced (`restore`) once the send settles, so a suggestion never costs the person their words.
 */
interface Queued {
  key: string;
  draft: ComposerDraft;
  send: boolean;
  restore: ComposerDraft | null;
}

/**
 * The panel's side of the suggested next steps: undefined while the setting is off, otherwise
 * what a click does and the actions, which stay the same object across renders so the turns'
 * action rows do not render again per streamed patch. Sending goes through the panel's own
 * submit, so a suggestion is sent with the conversation's model and policy exactly as a typed
 * message would be.
 */
export function useNextStepsHost(panel: PanelDrafts): NextStepsHost | undefined {
  const latest = useRef(panel);
  useLayoutEffect(() => {
    latest.current = panel;
  });
  // A ref, not state: the draft change or view switch that queuing causes renders anyway, and the
  // effect below reads it then.
  const queue = useRef<Queued | null>(null);
  const [actions] = useState<NextStepActions>(() => ({
    fill: (taskId, prompt) => {
      const { draftKey, changeDraft } = latest.current;
      if (draftKey !== taskId) return;
      // The editor takes an outside draft with the caret at its end.
      changeDraft(seedFromText(prompt));
      requestAnimationFrame(focusPanelInput);
    },
    send: (taskId, prompt) => {
      const { draftKey, draft, changeDraft } = latest.current;
      if (draftKey !== taskId) return;
      const seeded = seedFromText(prompt);
      queue.current = {
        key: taskId,
        draft: seeded,
        send: true,
        restore: isEmptyDraft(draft) ? null : draft,
      };
      changeDraft(seeded);
    },
    newTask: (prompt, start) => {
      queue.current = {
        key: NEW_CONVERSATION,
        draft: seedFromText(prompt),
        send: start,
        restore: null,
      };
      latest.current.newTask();
    },
  }));

  // Runs once the queued conversation is the served one: first its draft becomes the prompt, and
  // once a commit shows that draft (so submit reads it) the prompt is focused or sent.
  const { draftKey, draft } = panel;
  useEffect(() => {
    const queued = queue.current;
    if (!queued || draftKey !== queued.key) return;
    const current = latest.current;
    if (!sameContent(draft, queued.draft)) {
      current.changeDraft(queued.draft);
      return;
    }
    queue.current = null;
    if (!queued.send) {
      requestAnimationFrame(focusPanelInput);
      return;
    }
    const { key, restore } = queued;
    // A copy: the editor ignores a draft object it emitted itself, as the replaced draft was.
    const settle = () => {
      if (restore && latest.current.draftKey === key) latest.current.changeDraft({ ...restore });
    };
    current.submit().then(settle, (error: unknown) => {
      settle();
      showErrorToast(error);
    });
  }, [draftKey, draft]);

  const enabled = panel.settings?.nextSteps ?? DEFAULT_NEXT_STEPS;
  const click = panel.settings?.nextStepClick ?? DEFAULT_NEXT_STEP_CLICK;
  return useMemo(() => (enabled ? { click, actions } : undefined), [enabled, click, actions]);
}
