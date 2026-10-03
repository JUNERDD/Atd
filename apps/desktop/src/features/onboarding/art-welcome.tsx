import { AppIcon, ArtStage } from './art-panel';

/** Page one's art: the app icon, over the welcome light the art panel draws. */
export function WelcomeArt() {
  return (
    <ArtStage name="welcome">
      <AppIcon />
    </ArtStage>
  );
}
