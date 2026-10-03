import { useId, useRef } from 'react';
import { useIsPresent } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { SelectionToolbarSettings } from '../../client/settings-contract';
import { shortcutKeys } from '../../lib/shortcuts';
import { activationAccelerator } from '../settings/use-selection-toolbar-settings';
import { Keycaps } from './keycaps';
import './selection-illustration.css';
import { usePracticeSelection } from './use-practice-selection';

/**
 * The selection step's practice area, in the card's display panel: a short paragraph the user
 * selects to see the real selection toolbar (the shell's, not a picture of it) appear beside the
 * selection, here in the guide instead of another app. Its caption invites the try the way the
 * activation asks for (holding the key, or pressing it twice first), or says what the toolbar
 * still needs: Accessibility access, then the toolbar switch. Below it, while keys are involved,
 * their keycaps follow the keyboard, as on the shortcut step. The shell applies the
 * activation itself. The text stays selectable either way, but the selection reaches the shell
 * only while both are in place, the card is at rest (`active`) and the step is not leaving.
 */
export function SelectionPractice({
  enabled,
  activation: { activation, activationKeys },
  trusted,
  active,
  platform,
}: {
  enabled: boolean;
  activation: Pick<SelectionToolbarSettings, 'activation' | 'activationKeys'>;
  trusted: boolean;
  active: boolean;
  platform: string;
}) {
  const { t } = useTranslation('onboarding');
  const text = useRef<HTMLParagraphElement>(null);
  const captionId = useId();
  const present = useIsPresent();
  usePracticeSelection(text, active && present && enabled && trusted);
  const accelerator = activationAccelerator(activationKeys);
  const key = shortcutKeys(accelerator, platform).join('');
  let caption = t('selection.practice.caption');
  if (activation === 'hold') caption = t('selection.practice.captionHold', { key });
  else if (activation === 'toggle') caption = t('selection.practice.captionToggle', { key });
  if (!trusted) caption = t('selection.practice.needsAccess');
  else if (!enabled) caption = t('selection.practice.needsToolbar');
  return (
    <div className="guide-practice">
      <section
        aria-label={t('selection.practice.label')}
        aria-describedby={captionId}
        className="guide-practice-page"
      >
        <p ref={text}>{t('selection.practice.sample')}</p>
      </section>
      <p id={captionId} className="guide-practice-caption">
        {caption}
      </p>
      {activation !== 'always' && (
        <div className="guide-practice-keys">
          <Keycaps accelerator={accelerator} platform={platform} />
        </div>
      )}
    </div>
  );
}
