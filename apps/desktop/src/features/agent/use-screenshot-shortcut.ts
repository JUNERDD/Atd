import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_ATTACHMENTS } from '@atd/agent-contracts';
import type { Screenshot } from '../../client/agent/screenshot-input';
import { showErrorToast } from '../../components/toast-store';
import {
  appendChip,
  draftFiles,
  screenshotChip,
  type ComposerDraft,
} from '../composer-editor/draft';
import { showPanel } from './use-panel-window';

/**
 * The global screenshot shortcut, which the shell hands to the panel page. The page captures with
 * the panel out of the way, appends the image (with its screen context while there is room) to
 * the composer's draft, and reveals the panel with the composer on screen: `showComposer` leaves a
 * view that has none or covers it. A draft without room is refused before the overlay opens, a
 * cancelled capture leaves the panel as it was, and a failure shows the panel with its error.
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
  // A second press before the overlay opens would only be refused by the shell.
  const capturing = useRef(false);

  async function refuse(message: unknown) {
    showErrorToast(message);
    latest.current.showComposer();
    await showPanel();
  }

  const capture = useEffectEvent(async () => {
    const desktop = window.desktop;
    if (!desktop || capturing.current) return;
    if (draftFiles(draft).length >= MAX_ATTACHMENTS) return refuse(t('composer.attachLimit'));
    capturing.current = true;
    let shot: Screenshot | null;
    // The catch resets the flag itself: React Compiler skips a function with `finally`.
    try {
      shot = await desktop.screenshot();
    } catch (error) {
      capturing.current = false;
      return refuse(error);
    }
    capturing.current = false;
    if (!shot) return;
    const current = latest.current;
    const room = MAX_ATTACHMENTS - draftFiles(current.draft).length;
    current.changeDraft(appendChip(current.draft, screenshotChip(shot, room)));
    current.showComposer();
    await showPanel();
  });

  useEffect(() => window.desktop?.onScreenshotShortcut?.(() => void capture()), []);
}
