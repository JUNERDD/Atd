import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_ATTACHMENTS } from '@atd/agent-contracts';
import type { CaptureMode } from '../../client/capture-bridge';
import { showErrorToast } from '../../components/toast-store';
import { appendChip, type ComposerDraft } from '../composer-editor/draft';
import { draftFiles, screenshotChip } from '../composer-editor/draft-attachments';
import { captureScreen } from './capture-screen';
import { showPanel } from './use-panel-window';

/**
 * The global screenshot and record-screen shortcuts, which the shell hands to the panel page. The
 * page captures with the panel out of the way and the screenshot toolbar on, then acts on how the
 * capture ended: a screenshot goes into the composer's draft (with its screen context while there
 * is room) and the panel shows with the composer on screen (`showComposer` leaves a view that has
 * none or covers it). `captureScreen` dispatches toolbar questions and commands for every entry;
 * a cancelled capture, or
 * one that became a recording, leaves the panel as it was. Only a screenshot that would go into the
 * draft needs room there, so a full draft refuses it once the capture ends that way, never before
 * the overlay opens; a failure shows the panel with its error.
 */
export function useScreenshotShortcut({
  draft,
  changeDraft,
  showComposer,
}: {
  draft: ComposerDraft;
  changeDraft: (draft: ComposerDraft) => void;
  showComposer: () => void;
}): void {
  const { t } = useTranslation('panel');
  // The panel as of the latest commit: the capture resolves after renders the press did not see.
  const latest = useRef({ draft, changeDraft, showComposer });
  useLayoutEffect(() => {
    latest.current = { draft, changeDraft, showComposer };
  });
  async function refuse(message: unknown) {
    showErrorToast(message);
    latest.current.showComposer();
    await showPanel();
  }

  const capture = useEffectEvent(async (mode: CaptureMode) => {
    try {
      const shot = await captureScreen(mode);
      if (!shot) return;
      const current = latest.current;
      const room = MAX_ATTACHMENTS - draftFiles(current.draft).length;
      if (room <= 0) return refuse(t('composer.attachLimit'));
      current.changeDraft(appendChip(current.draft, screenshotChip(shot, room)));
      current.showComposer();
      await showPanel();
    } catch (error) {
      return refuse(error);
    }
  });

  useEffect(() => window.desktop?.capture?.onShortcut((mode) => void capture(mode)), []);
}
