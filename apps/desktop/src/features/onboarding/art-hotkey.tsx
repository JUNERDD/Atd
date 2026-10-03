import { ArtStage } from './art-panel';
import { Keycaps } from './keycaps';

/**
 * The panel shortcut as large keycaps that follow the keyboard (`Keycaps`). Whether the shortcut
 * has already worked is the step's goal status to say; the keycaps stay the same.
 */
export function HotkeyArt({ accelerator, platform }: { accelerator: string; platform: string }) {
  return (
    <ArtStage name="hotkey">
      <Keycaps accelerator={accelerator} platform={platform} />
    </ArtStage>
  );
}
