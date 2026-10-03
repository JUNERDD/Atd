import { motion, useReducedMotion } from 'motion/react';
import { shortcutKeys } from '../../lib/shortcuts';
import { ArtStage } from './art-panel';
import { PRESS_IN, RELEASE_SPRING } from './step-motion';
import { useHeldKeys } from './use-held-keys';

/**
 * The panel shortcut as large keycaps, one per key of the user's binding, that follow the
 * keyboard: a held key's face sinks onto its base and darkens toward the foreground at once, and
 * springs back on release. Under Reduce Motion only the fill changes. Whether the shortcut has
 * already worked is the step's goal status to say; the keycaps stay the same.
 */
export function HotkeyArt({ accelerator, platform }: { accelerator: string; platform: string }) {
  const reduced = useReducedMotion() ?? false;
  const keys = shortcutKeys(accelerator, platform);
  const held = useHeldKeys(accelerator, platform);
  return (
    <ArtStage name="hotkey">
      <span className="guide-keycaps">
        {keys.map((key, index) => {
          const pressed = held[index] ?? false;
          return (
            <span key={`${index}-${key}`} className="guide-keycap">
              <motion.span
                className="guide-keycap-face"
                data-pressed={pressed || undefined}
                data-wide={key.length > 1 || undefined}
                animate={pressed && !reduced ? { y: 3, scale: 0.97 } : { y: 0, scale: 1 }}
                transition={pressed ? PRESS_IN : RELEASE_SPRING}
              >
                {key}
              </motion.span>
            </span>
          );
        })}
      </span>
    </ArtStage>
  );
}
