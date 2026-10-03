import { useId, useRef } from 'react';
import { useIsPresent } from 'motion/react';
import { useTranslation } from 'react-i18next';
import './selection-illustration.css';
import { usePracticeSelection } from './use-practice-selection';

/**
 * The selection step's practice area, in the card's display panel: a short paragraph the user
 * selects to see the real selection toolbar (the shell's, not a picture of it) appear beside the
 * selection, here in the guide instead of another app. Its caption invites the try, or says what
 * the toolbar still needs: Accessibility access, then the toolbar switch. The text stays
 * selectable either way, but the selection reaches the shell only while both are in place, the
 * card is at rest (`active`) and the step is not leaving.
 */
export function SelectionPractice({
  enabled,
  trusted,
  active,
}: {
  enabled: boolean;
  trusted: boolean;
  active: boolean;
}) {
  const { t } = useTranslation('onboarding');
  const text = useRef<HTMLParagraphElement>(null);
  const captionId = useId();
  const present = useIsPresent();
  usePracticeSelection(text, active && present && enabled && trusted);
  let caption = t('selection.practice.caption');
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
    </div>
  );
}
