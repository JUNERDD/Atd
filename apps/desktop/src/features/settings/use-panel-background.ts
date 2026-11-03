import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_PANEL_BACKGROUND,
  type PanelBackground,
  type SettingsSnapshot,
} from '../../client/settings-contract';
import { useSettingsSectionExit } from './settings-navigation';
import { showSettingsSnapshot } from './use-settings';

/** The control a change came from, under which its failure shows. */
export type PanelBackgroundControl =
  | 'transparency'
  | 'tone'
  | 'tint'
  | 'variant'
  | 'blur'
  | 'refractionWidth'
  | 'refractionStrength'
  | 'restore';

interface Change {
  value: PanelBackground;
  control: PanelBackgroundControl;
}

/**
 * The panel background setting as General edits it: the summary row and the sub-page share one
 * instance, so a save that outlives the sub-page still finishes in order. A change shows at once
 * and saves the whole value; a slider sends many, so at most one write is in flight and only the
 * latest change waits behind it, the ones in between being dropped. The shown value is the latest
 * change until the writes settle, then the stored one, which a failed last write leaves in place;
 * its error shows under the control it came from until the next change or leaving the section.
 */
export function usePanelBackground(snapshot: SettingsSnapshot | null) {
  const { t } = useTranslation('settings');
  const save = window.desktop?.settings.setPanelBackground;
  const unavailable = !snapshot || !save;
  const [draft, setDraft] = useState<PanelBackground | null>(null);
  const [error, setError] = useState<{ control: PanelBackgroundControl; message: string }>();
  // The change waiting for the write in flight, and whether one is; only handlers touch it.
  const queue = useRef<{ waiting: Change | null; writing: boolean }>({
    waiting: null,
    writing: false,
  });
  useSettingsSectionExit(() => setError(undefined));

  async function drain(write: (value: PanelBackground) => Promise<SettingsSnapshot>) {
    const state = queue.current;
    state.writing = true;
    let failure: { control: PanelBackgroundControl; message: string } | undefined;
    while (state.waiting) {
      const { value, control } = state.waiting;
      state.waiting = null;
      try {
        showSettingsSnapshot(await write(value));
        failure = undefined;
      } catch (reason) {
        failure = {
          control,
          message:
            reason instanceof Error && reason.message
              ? reason.message
              : t('panelBackground.saveFailed'),
        };
      }
    }
    state.writing = false;
    setDraft(null);
    if (failure) setError(failure);
  }

  function change(value: PanelBackground, control: PanelBackgroundControl) {
    if (!save || unavailable) return;
    setDraft(value);
    setError(undefined);
    queue.current.waiting = { value, control };
    if (!queue.current.writing) void drain(save);
  }

  return {
    value: draft ?? snapshot?.panelBackground ?? DEFAULT_PANEL_BACKGROUND,
    unavailable,
    /** The failure under `control`, if its change was the last to fail. */
    errorFor: (control: PanelBackgroundControl) =>
      error?.control === control ? error.message : undefined,
    change,
  };
}

export type PanelBackgroundSettings = ReturnType<typeof usePanelBackground>;
