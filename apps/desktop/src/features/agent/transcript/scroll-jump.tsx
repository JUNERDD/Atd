import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown } from 'lucide-react';
import { ShaderMount, type PaperShaderElement } from '@paper-design/shaders-react';
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useIsPresent,
  useReducedMotion,
  type Transition,
} from 'motion/react';
import { IconButton } from '../../../components/icon-button';
import { useShaderClock } from '../../../components/use-shader-clock';
import { DEFAULT_GLOW_EFFECTS } from '../../../client/settings-contract';
import { useColorScheme } from '../../../theme/color-scheme';
import { useSettingsSnapshot } from '../../settings/use-settings';
import { GLOW_SHADER } from '../waiting-glow/glow-field';
import { glowColors } from '../waiting-glow/glow-colors';
import { useGlowLevel } from '../waiting-glow/glow-level';
import './scroll-jump.css';

/**
 * Enter eases out like the progress pill above the composer. Exit is quicker and eases in, so the
 * action is gone while the transcript's smooth scroll is still gliding rather than competing with
 * it; it sinks toward the bottom the transcript is heading to.
 */
const ENTER: Transition = { duration: 0.2, ease: [0.22, 1, 0.36, 1] };
const EXIT: Transition = { duration: 0.15, ease: [0.4, 0, 1, 1] };
const PRESS: Transition = { duration: 0.1, ease: 'easeOut' };
const WEBGL2 = typeof WebGL2RenderingContext !== 'undefined';

/** The floating scroll-to-bottom action a transcript shows once the reader leaves the bottom. */
export function ScrollJump({
  show,
  live,
  onJump,
}: {
  show: boolean;
  live: boolean;
  onJump: () => void;
}) {
  const { t } = useTranslation('tasks');
  const { snapshot } = useSettingsSnapshot();
  const glow = snapshot?.glowEffects ?? DEFAULT_GLOW_EFFECTS;
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {show && (
          <motion.div
            className="scroll-to-bottom"
            // The exit keeps the pressed scale, so a clicked action never grows back while leaving.
            initial={{ opacity: 0, x: '-50%', y: 8, scale: 0.92 }}
            animate={{ opacity: 1, x: '-50%', y: 0, scale: 1, transition: ENTER }}
            exit={{ opacity: 0, x: '-50%', y: 8, scale: 0.92, transition: EXIT }}
            whileTap={{ scale: 0.92, transition: PRESS }}
          >
            <IconButton
              label={t('conversation.scrollToBottom')}
              tooltip={false}
              variant="glass"
              onClick={onJump}
            >
              {live && glow && WEBGL2 && <ScrollJumpGlow />}
              <ArrowDown className="scroll-jump-icon" />
            </IconButton>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

/** The mini panel's working field, at its control-sized strength, inside the existing glass. */
function ScrollJumpGlow() {
  const present = useIsPresent();
  const reduced = useReducedMotion() ?? false;
  const scheme = useColorScheme();
  const level = useGlowLevel({ light: 0.15, dark: 0.34 });
  const ref = useRef<PaperShaderElement>(null);
  const clock = useRef({ milliseconds: 0, phase: 0 });
  // Register every uniform at construction; the shared clock owns subsequent color updates.
  const [uniforms] = useState(() => ({
    u_elapsed: 0,
    u_phase: 0,
    u_colors: glowColors(0, scheme),
    u_bandRatio: 1,
    u_retreat: 0,
    u_retreatTarget: 0,
    u_entry: 0,
    u_fullCoverage: 1,
    u_origin: [0.5, 0],
    u_level: level,
  }));
  const draw = useCallback(
    (element: PaperShaderElement, milliseconds: number) => {
      if (!present) return;
      // Freeze at the current field under Reduce Motion, and resume there when motion returns.
      // The shared clock starts at zero after a pause, so only positive steps advance the phase.
      if (!reduced) {
        clock.current.phase += Math.max(0, milliseconds - clock.current.milliseconds) / 1000;
      }
      clock.current.milliseconds = milliseconds;
      element.paperShaderMount?.setUniforms({
        u_phase: clock.current.phase,
        u_colors: glowColors(clock.current.phase, scheme),
        u_level: level,
      });
    },
    [present, reduced, scheme, level],
  );
  useShaderClock(ref, 0, present && !reduced, 1000 / 30, 0, draw);
  useEffect(() => {
    if (ref.current) draw(ref.current, clock.current.milliseconds);
  }, [draw]);
  return (
    <ShaderMount
      ref={ref}
      aria-hidden
      className="scroll-jump-glow"
      fragmentShader={GLOW_SHADER}
      uniforms={uniforms}
      speed={0}
      frame={0}
      minPixelRatio={1}
      // The existing 28px control at up to 4x display scale; no panel-sized drawing buffer.
      maxPixelCount={28 * 28 * 4 * 4}
    />
  );
}
