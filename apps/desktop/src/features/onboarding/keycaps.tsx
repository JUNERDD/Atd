import { motion, useReducedMotion } from 'motion/react';
import { shortcutKeys } from '../../lib/shortcuts';
import './art-illustration.css';
import { PRESS_IN, RELEASE_SPRING } from './step-motion';
import { useHeldKeys } from './use-held-keys';

/**
 * Large keycaps, one per key of `accelerator`, that follow the keyboard: a held key's face sinks
 * onto its base and darkens toward the foreground at once, and springs back on release. Under
 * Reduce Motion only the fill changes. Sized in the art panel's unit (`--u`), so its container
 * must define it; decorative, so the step's text names the keys.
 */
export function Keycaps({ accelerator, platform }: { accelerator: string; platform: string }) {
  const reduced = useReducedMotion() ?? false;
  const keys = shortcutKeys(accelerator, platform);
  const held = useHeldKeys(accelerator, platform);
  return (
    <span className="guide-keycaps" aria-hidden="true">
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
  );
}
