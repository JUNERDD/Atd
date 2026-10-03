import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';

/**
 * The card's footer, which stays in view while the step scrolls: Back at the start (absent on the
 * first step), then Later and the step's primary action at the end. While the step's goal is unmet
 * the primary is disabled, a note above the buttons says what unlocks it (and describes the
 * button), and Later moves on leaving the step unfinished.
 */
export function OnboardingFooter({
  showBack,
  pending,
  primaryLabel,
  onBack,
  onLater,
  onPrimary,
}: {
  showBack: boolean;
  pending: boolean;
  primaryLabel: string;
  onBack: () => void;
  onLater: () => void;
  onPrimary: () => void;
}) {
  const { t } = useTranslation('onboarding');
  const noteId = useId();
  return (
    <footer className="onboarding-footer">
      {pending && (
        <p id={noteId} className="onboarding-footer-note">
          {t('chrome.goalPending')}
        </p>
      )}
      <div className="onboarding-footer-actions">
        {showBack && (
          <Button type="button" variant="ghost" onClick={onBack}>
            {t('chrome.back')}
          </Button>
        )}
        <div className="onboarding-footer-end">
          {pending && (
            <Button type="button" variant="ghost" onClick={onLater}>
              {t('chrome.later')}
            </Button>
          )}
          <Button
            type="button"
            disabled={pending}
            aria-describedby={pending ? noteId : undefined}
            onClick={onPrimary}
          >
            {primaryLabel}
          </Button>
        </div>
      </div>
    </footer>
  );
}
