import { Volume2, VolumeX, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/icon-button';
import type { OnboardingMusic } from './use-onboarding-music';

/**
 * The music's mute toggle, in the intro's corner and the card's top bar. The icon shows the
 * current state (a speaker, or a struck speaker while muted); the label names the action it
 * takes (turn the music off, or on). Absent while the music cannot play.
 */
export function MusicToggle({
  music,
  className,
}: {
  music: Pick<OnboardingMusic, 'muted' | 'available' | 'toggle'>;
  className?: string;
}) {
  const { t } = useTranslation('onboarding');
  if (!music.available) return null;
  return (
    <IconButton
      label={music.muted ? t('chrome.musicOn') : t('chrome.musicOff')}
      className={className}
      onClick={music.toggle}
    >
      {music.muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
    </IconButton>
  );
}

/** Closes the guide without summoning the panel. */
export function CloseButton({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('onboarding');
  return (
    <IconButton label={t('chrome.close')} onClick={onClose}>
      <X aria-hidden />
    </IconButton>
  );
}
